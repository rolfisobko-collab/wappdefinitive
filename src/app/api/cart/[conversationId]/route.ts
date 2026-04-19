import { NextResponse } from "next/server";
import { getCart, addToCart, removeFromCart } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await params;
    return NextResponse.json(await getCart(conversationId));
  } catch (error) {
    console.error("[GET /api/cart]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await params;
    const { productId, quantity = 1 } = await req.json();
    return NextResponse.json(await addToCart(conversationId, productId, quantity));
  } catch (error) {
    console.error("[POST /api/cart]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await params;
    const { itemId } = await req.json();
    return NextResponse.json(await removeFromCart(conversationId, itemId));
  } catch (error) {
    console.error("[DELETE /api/cart]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
