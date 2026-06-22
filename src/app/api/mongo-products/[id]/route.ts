import { NextResponse } from "next/server";
import { getMongoDB } from "@/lib/mongodb";
import { normalizeProductColor } from "@/lib/productColors";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if ("color" in body) {
      updates.color = normalizeProductColor(body.color) ?? "";
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
    }

    updates.updatedAt = new Date().toISOString();

    const db = await getMongoDB();
    const result = await db.collection("stock").updateOne({ _id: id } as object, { $set: updates });
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[mongo-products PATCH]", error);
    return NextResponse.json({ error: "Error al actualizar producto" }, { status: 500 });
  }
}
