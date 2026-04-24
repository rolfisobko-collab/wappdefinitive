import { NextRequest, NextResponse } from "next/server";
import { getMPPayment } from "@/lib/mercadopago";
import { getMongoDB, updateOrderStatus } from "@/lib/mongodb";

/**
 * Webhook de notificaciones IPN de Mercado Pago.
 * MP envía un POST cada vez que un pago cambia de estado.
 * Se usa external_reference = orderId (MongoDB ObjectId) para vincular el pago al pedido.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { type, data } = body as { type?: string; data?: { id?: string | number } };

    // MP puede enviar tipo "payment" o "merchant_order"
    if (type !== "payment" || !data?.id) {
      return NextResponse.json({ ok: true });
    }

    const paymentId = data.id;
    const payment = await getMPPayment(paymentId);

    const status       = payment.status;          // approved | rejected | pending | in_process
    const extRef       = payment.external_reference; // nuestro orderId en MongoDB
    const mpPaymentId  = payment.id;

    if (!extRef) {
      console.warn("[mp-webhook] Sin external_reference en pago", paymentId);
      return NextResponse.json({ ok: true });
    }

    if (status === "approved") {
      await updateOrderStatus(extRef, {
        status: "confirmed",
        paymentStatus: "paid",
        mpPaymentId: String(mpPaymentId),
      });

      // Descontar stock automáticamente al confirmarse el pago
      try {
        const { ObjectId } = await import("mongodb");
        const db = await getMongoDB();
        const filter = /^[a-f\d]{24}$/i.test(extRef)
          ? { _id: new ObjectId(extRef) }
          : { _id: extRef };
        const order = await db.collection("orders").findOne(filter as never) as Record<string, unknown> | null;

        if (order && !order.stockDeducted) {
          const items = (order.items || []) as { productId: string; quantity?: number; qty?: number }[];
          if (items.length > 0) {
            const bulkOps = items.map((item) => {
              const qty = Number(item.quantity || item.qty || 0);
              const prodFilter = /^[a-f\d]{24}$/i.test(item.productId)
                ? { _id: new ObjectId(item.productId) }
                : { _id: item.productId };
              return {
                updateOne: {
                  filter: prodFilter as never,
                  update: { $inc: { quantity: -qty } },
                },
              };
            });
            await db.collection("stock").bulkWrite(bulkOps, { ordered: false });
            await db.collection("orders").updateOne(filter as never, {
              $set: { stockDeducted: true, updatedAt: new Date().toISOString() },
            });
          }
        }
      } catch (stockErr) {
        console.error("[mp-webhook] Error descontando stock:", stockErr);
      }

      console.log(`[mp-webhook] ✅ Pago ${paymentId} aprobado → pedido ${extRef} confirmado`);

    } else if (status === "rejected" || status === "cancelled") {
      await updateOrderStatus(extRef, {
        status: "cancelled",
        paymentStatus: "rejected",
        mpPaymentId: String(mpPaymentId),
      });
      console.log(`[mp-webhook] ❌ Pago ${paymentId} rechazado → pedido ${extRef} cancelado`);

    } else {
      // pending, in_process, etc. — solo actualizamos el paymentId
      await updateOrderStatus(extRef, {
        paymentStatus: "pending",
        mpPaymentId: String(mpPaymentId),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[mp-webhook] Error:", e);
    // Siempre devolver 200 a MP para que no reintente
    return NextResponse.json({ ok: true });
  }
}

// MP también hace un GET al configurar el webhook
export function GET() {
  return NextResponse.json({ status: "MP webhook active" });
}
