import { NextResponse } from "next/server";
import { getConversation, createMessage, getMessages, getAIConfig, getProducts, getWAConfig, updateMessage } from "@/lib/db";
import { generateAIResponse, AIMessage } from "@/lib/ai";
import { getWAClient } from "@/lib/whatsapp";

type AnyMap = Record<string, unknown>;
type GlobalWithIO = { io?: { to: (r: string) => { emit: (e: string, d: unknown) => void } } };

function phone(conv: unknown): string {
  return ((conv as AnyMap).contact as AnyMap)?.phone as string ?? "";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;
    const { content, type = "text", isManual = false } = await req.json();
    if (!content) return NextResponse.json({ error: "content requerido" }, { status: 400 });

    const conversation = await getConversation(conversationId);
    if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

    const message = await createMessage({
      conversationId, content, type,
      direction: "outbound",
      sender: isManual ? "agent" : "ai",
      status: "sent",
    });

    const waConfig = await getWAConfig() as AnyMap | null;
    if (waConfig?.phoneNumberId && waConfig?.accessToken) {
      try {
        const wa = getWAClient(waConfig.phoneNumberId as string, waConfig.accessToken as string);
        const waRes = await wa.sendTextMessage(phone(conversation), content);
        if (waRes?.messages?.[0]?.id) await updateMessage(message.id, { waMessageId: waRes.messages[0].id });
      } catch (e) { console.warn("[WA]", e); }
    }

    const io = (global as unknown as GlobalWithIO).io;
    io?.to(`conversation:${conversationId}`).emit("new-message", { conversationId, message });
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error("[POST messages]", error);
    return NextResponse.json({ error: "Error al enviar" }, { status: 500 });
  }
}

export async function PUT(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;

    const conversation = await getConversation(conversationId);
    if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    const conv = conversation as AnyMap;
    if (!conv.aiEnabled || conv.aiPaused) return NextResponse.json({ error: "IA deshabilitada" }, { status: 400 });

    const aiConfig = await getAIConfig() as AnyMap;
    const products = await getProducts(true);
    const msgs = await getMessages(conversationId, 20);

    const history: AIMessage[] = msgs.map((m) => ({
      role: (m as AnyMap).direction === "inbound" ? "user" : "assistant",
      content: (m as AnyMap).content as string,
    }));

    const aiText = await generateAIResponse(
      aiConfig.systemPrompt as string, history, products as never,
      undefined, aiConfig.temperature as number, aiConfig.maxTokens as number,
      aiConfig.includeProducts as boolean, aiConfig.groqApiKey as string | null,
    );

    const message = await createMessage({ conversationId, content: aiText, direction: "outbound", sender: "ai", status: "sent" });

    const waConfig = await getWAConfig() as AnyMap | null;
    if (waConfig?.phoneNumberId && waConfig?.accessToken) {
      try {
        const wa = getWAClient(waConfig.phoneNumberId as string, waConfig.accessToken as string);
        await wa.sendTextMessage(phone(conversation), aiText);
      } catch (e) { console.warn("[WA]", e); }
    }

    const io = (global as unknown as GlobalWithIO).io;
    io?.to(`conversation:${conversationId}`).emit("ai-response", { conversationId, message });
    return NextResponse.json(message);
  } catch (error) {
    console.error("[PUT messages AI]", error);
    return NextResponse.json({ error: "Error IA" }, { status: 500 });
  }
}
