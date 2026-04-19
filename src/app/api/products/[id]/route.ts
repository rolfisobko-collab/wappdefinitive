import { NextResponse } from "next/server";
import { updateProduct, deleteProduct } from "@/lib/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name        = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.price       !== undefined) updates.price       = parseFloat(body.price);
    if (body.currency    !== undefined) updates.currency    = body.currency;
    if (body.imageUrl    !== undefined) updates.imageUrl    = body.imageUrl;
    if (body.category    !== undefined) updates.category    = body.category;
    if (body.sku         !== undefined) updates.sku         = body.sku;
    if (body.stock       !== undefined) updates.stock       = parseInt(body.stock);
    if (typeof body.active === "boolean") updates.active    = body.active;
    await updateProduct(id, updates);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/products/[id]]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteProduct(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/products/[id]]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
