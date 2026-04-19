import { NextResponse } from "next/server";
import { getConversation, updateConversation } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conversation = await getConversation(id);
    if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    await updateConversation(id, { unreadCount: 0 });
    return NextResponse.json(conversation);
  } catch (error) {
    console.error("[GET /api/conversations/[id]]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await updateConversation(id, body);

    const io = (global as unknown as { io?: { to: (r: string) => { emit: (e: string, d: unknown) => void } } }).io;
    io?.to(`conversation:${id}`).emit("conversation-updated", { conversationId: id, updates: body });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/conversations/[id]]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
