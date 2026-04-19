import { NextResponse } from "next/server";
import { getConversations, upsertContact, createConversation, findOpenConversation } from "@/lib/db";

export async function GET() {
  try {
    const conversations = await getConversations();
    return NextResponse.json(conversations);
  } catch (error) {
    console.error("[GET /api/conversations]", error);
    return NextResponse.json({ error: "Error al obtener conversaciones" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { phone, name } = await req.json();
    if (!phone) return NextResponse.json({ error: "phone requerido" }, { status: 400 });

    const contact = await upsertContact(phone, name);
    const existingConv = await findOpenConversation(contact.id);
    const conv = existingConv ?? await createConversation(contact.id);

    return NextResponse.json({ ...conv, contact }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/conversations]", error);
    return NextResponse.json({ error: "Error al crear conversación" }, { status: 500 });
  }
}
