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
    const body = await req.json();
    // Accept MongoDB product data
    const product = {
      mongoProductId: body.mongoProductId ?? body.productId,
      name:           body.name ?? "Producto",
      image:          body.image ?? null,
      unitPriceUSD:   body.unitPriceUSD ?? body.price ?? 0,
      unitPriceARS:   body.unitPriceARS ?? 0,
    };
    return NextResponse.json(await addToCart(conversationId, product, body.quantity ?? 1));
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
