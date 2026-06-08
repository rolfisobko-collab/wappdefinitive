import { NextRequest, NextResponse } from "next/server";
import { getMongoOrders, updateMongoOrder } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 80);
    const data = await getMongoOrders(Number.isFinite(limit) ? limit : 80);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[GET /api/orders]", error);
    return NextResponse.json({ error: "Error al obtener pedidos" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    await updateMongoOrder(body.id, {
      status: body.status,
      paymentStatus: body.paymentStatus,
      deliveryType: body.deliveryType,
      deliveryStatus: body.deliveryStatus,
      shippingProvider: body.shippingProvider,
      trackingUrl: body.trackingUrl,
      shippingId: body.shippingId,
      notes: body.notes,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/orders]", error);
    return NextResponse.json({ error: "Error al actualizar pedido" }, { status: 500 });
  }
}
