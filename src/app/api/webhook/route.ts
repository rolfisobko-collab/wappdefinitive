import { NextRequest, NextResponse } from "next/server";
import { upsertContact, findOpenConversation, createConversation, createMessage, findMessageByWAId, updateConversation, getAIConfig, getProducts, getWAConfig } from "@/lib/db";
import { parseIncomingWebhook, getWAClient, WAWebhookBody } from "@/lib/whatsapp";
import { generateAIResponse, AIMessage } from "@/lib/ai";

const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN ?? "wapp_hub_2026";

type GlobalWithIO = {
  io?: {
    to: (r: string) => { emit: (e: string, d: unknown) => void };
    emit: (e: string, d: unknown) => void;
  };
};

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");

  // Also check token stored in Firestore
  const waConfig = await getWAConfig() as Record<string, string> | null;
  const storedToken = waConfig?.verifyToken ?? WA_VERIFY_TOKEN;

  if (mode === "subscribe" && token === storedToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body: WAWebhookBody = await req.json();
    if (body.object !== "whatsapp_business_account") return NextResponse.json({ status: "ignored" });

    const parsed = parseIncomingWebhook(body);

    for (const msg of parsed) {
      const contact = await upsertContact(msg.from, msg.contactName);

      let conversation = await findOpenConversation(contact.id);
      if (!conversation) conversation = await createConversation(contact.id);

      if (await findMessageByWAId(msg.messageId)) continue;

      const inbound = await createMessage({
        conversationId: conversation.id,
        waMessageId: msg.messageId,
        direction: "inbound",
        sender: "contact",
        type: "text",
        content: msg.text || `[${msg.type}]`,
        status: "delivered",
      });

      await updateConversation(conversation.id, {
        unreadCount: ((conversation as Record<string, unknown>).unreadCount as number ?? 0) + 1,
      });

      const io = (global as unknown as GlobalWithIO).io;
      io?.to(`conversation:${conversation.id}`).emit("new-message", { conversationId: conversation.id, message: inbound });
      io?.emit("conversation-updated", { conversationId: conversation.id, updates: { unreadCount: 1 } });

      // Mark as read
      const waConfig = await getWAConfig() as Record<string, string> | null;
      if (waConfig?.phoneNumberId && waConfig?.accessToken) {
        try {
          const waClient = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
          await waClient.markAsRead(msg.messageId);
        } catch { /* ignore */ }
      }

      // AI response
      const freshConv = await findOpenConversation(contact.id);
      if (freshConv && (freshConv as Record<string, unknown>).aiEnabled && !(freshConv as Record<string, unknown>).aiPaused) {
        const aiConfig = await getAIConfig() as Record<string, unknown>;
        const products = await getProducts(true);
        const msgs = (freshConv as Record<string, unknown>).messages as Array<Record<string, unknown>>;

        const history: AIMessage[] = (msgs ?? []).map((m) => ({
          role: m.direction === "inbound" ? "user" : "assistant",
          content: m.content as string,
        }));

        try {
          const aiText = await generateAIResponse(
            aiConfig.systemPrompt as string,
            history,
            products as never,
            undefined,
            aiConfig.temperature as number,
            aiConfig.maxTokens as number,
            aiConfig.includeProducts as boolean,
            aiConfig.groqApiKey as string | null,
          );

          const aiMsg = await createMessage({
            conversationId: conversation.id,
            direction: "outbound", sender: "ai", status: "sent", content: aiText,
          });

          if (waConfig?.phoneNumberId && waConfig?.accessToken) {
            try {
              const waClient = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
              await waClient.sendTextMessage(contact.phone as string, aiText);
            } catch (e) { console.error("[WA Send]", e); }
          }

          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: aiMsg });
        } catch (e) { console.error("[AI Error]", e); }
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook POST]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
