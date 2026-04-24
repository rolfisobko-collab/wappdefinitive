import { NextRequest, NextResponse } from "next/server";
import {
  upsertContact, findOpenConversation, createConversation, createMessage,
  findMessageByWAId, updateConversation, getAIConfig, getWAConfig,
  addToCart, getCart, removeFromCart,
} from "@/lib/db";
import { parseIncomingWebhook, getWAClient, WAWebhookBody, downloadWAMedia } from "@/lib/whatsapp";
import { generateAIResponse, transcribeAudio, AIMessage } from "@/lib/ai";
import { getMongoProducts, getMongoProductById, createOrderInMongo, updateOrderStatus, expandKeywords, MongoProduct } from "@/lib/mongodb";
import { createMPPreference, calcTransferTotal, TRANSFER_INFO, USDT_INFO } from "@/lib/mercadopago";

const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN ?? "alta_wa_2026";

type GlobalWithIO = {
  io?: {
    to: (r: string) => { emit: (e: string, d: unknown) => void };
    emit: (e: string, d: unknown) => void;
  };
};

// ─── Intent detection ───────────────────────────────────────────────────────

function detectIntent(text: string): "cart_view" | "cart_confirm" | "cart_clear" | null {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡]/g, "");

  if (
    /\bmi carrito\b/.test(t) ||
    /\bver (el |mi )?carrito\b/.test(t) ||
    /\bmostrar(me)? (el |mi )?carrito\b/.test(t) ||
    /\bque (tengo|hay) en (el |mi )?carrito\b/.test(t) ||
    /\bcuanto (tengo|hay) en (el |mi )?carrito\b/.test(t) ||
    (/\bcarrito\b/.test(t) && /\b(ver|mostrar|dame|manda|quiero|muestra)\b/.test(t))
  ) return "cart_view";

  if (
    /\bquiero pagar\b/.test(t) ||
    /\bvoy a pagar\b/.test(t) ||
    /\bcomo (se |puedo )?pag[ao]\b/.test(t) ||
    /\bformas? de pago\b/.test(t) ||
    /\bmetodos? de pago\b/.test(t) ||
    /\bopciones? de pago\b/.test(t) ||
    /\bconfirmar (el |mi )?pedido\b/.test(t) ||
    /\bfinalizar (la |mi )?compra\b/.test(t) ||
    /\bproceder al pago\b/.test(t) ||
    /\bpagar (el |mi )?pedido\b/.test(t) ||
    /\bquiero comprar\b/.test(t)
  ) return "cart_confirm";

  if (
    /\bvaciar (el |mi )?carrito\b/.test(t) ||
    /\bborrar (el |mi )?carrito\b/.test(t) ||
    /\blimpiar (el |mi )?carrito\b/.test(t) ||
    /\beliminar.*(carrito|pedido)\b/.test(t)
  ) return "cart_clear";

  return null;
}

// ─── Product query gate ──────────────────────────────────────────────────────
// Only search MongoDB when the message is clearly about a product/part/brand.
// This prevents greetings, location questions, etc. from triggering product injection.

const PRODUCT_INTENT_RE = new RegExp(
  [
    // Brands
    "\\b(iphone|samsung|xiaomi|motorola|oppo|realme|nokia|huawei|lg|sony|apple|poco|redmi|tcl|alcatel)\\b",
    // Part types (accent-stripped)
    "\\b(pantalla|modulo|modulos|bateria|baterias|camara|camaras|flex|placa|placas|repuesto|repuestos|cargador|cable|funda|vidrio|tactil|auricular|parlante|bocina|microfono|boton|altavoz|tapa|carcasa|marco|lente|sensor|chip|conector|puerto|lcd|display|touch|cristal)\\b",
    // Common search phrases
    "\\b(precio|stock|disponible|cuanto cuesta|cuanto sale|tienen|busco|necesito|quiero|conseguir)\\b.{0,30}\\b(pantalla|modulo|bateria|camara|flex|placa|repuesto|celular|telefono)\\b",
  ].join("|"),
  "i"
);

function isProductQuery(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return PRODUCT_INTENT_RE.test(normalized);
}

// ─── AI history builder (excludes product-search exchanges) ─────────────────
// Strategy: look at the USER message to decide if an exchange was about products.
// This is far more reliable than trying to regex-match the AI's varying responses.
// Also skips interactive button presses ([🛒 Agregar], etc.) — they're noise.

function buildAIHistory(msgs: Array<Record<string, unknown>>): AIMessage[] {
  const result: AIMessage[] = [];
  let skipNextBot = false;

  for (const m of msgs) {
    if (m.direction === "inbound") {
      const text = (m.content as string) ?? "";

      // Skip interactive button presses — they're not conversational context
      if (text.startsWith("[") && text.endsWith("]")) {
        skipNextBot = false;
        continue;
      }

      // If the user message is a product query, skip it and the following bot response
      if (isProductQuery(text)) {
        skipNextBot = true;
        continue;
      }

      skipNextBot = false;
      result.push({ role: "user", content: text });
    } else {
      // Outbound (AI response)
      if (skipNextBot) {
        skipNextBot = false;
        continue; // skip the bot response that followed a product query
      }
      // Belt-and-suspenders: also skip via metadata flag (for any edge cases)
      try {
        const meta = m.metadata ? JSON.parse(m.metadata as string) : {};
        if (meta.isProductSearch) continue;
      } catch { /* keep */ }

      const content = (m.content as string) ?? "";
      if (content.trim()) result.push({ role: "assistant", content });
    }
  }
  return result;
}

// ─── Keyword extraction ─────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "para", "que", "como", "con", "por", "una", "uno", "los", "las", "del",
  "esto", "esta", "tiene", "tenes", "cuanto", "hay", "quiero",
  "necesito", "busco", "hola", "buenas", "buenos", "gracias", "quisiera",
  "podria", "podes", "tienen", "puedo", "ver", "lista", "catalogo", "haber",
  "dame", "manda", "mandame", "sos", "son", "mas", "sin", "saber",
  "alguno", "alguna", "donde", "cuando", "cual", "tenes", "info",
  // NO incluir "precio", "stock", "disponible" — son señales de búsqueda
]);

function extractKeywords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

  // Keep numeric tokens (model numbers like 13, 15, s8, a54) even if short
  // Keep alpha tokens only if length > 2
  const filtered = normalized.filter((w) => /^\d+$/.test(w) ? w.length >= 1 : w.length > 2);

  // Detect phone model phrases like "13 pro max", "s23 ultra", "a54" and keep them together
  // as individual tokens — just return filtered tokens, MongoDB AND search handles precision
  return filtered.slice(0, 8);
}

// ─── Cart message builder ────────────────────────────────────────────────────

function buildCartText(items: Array<{ name: string; quantity: number; unitPriceUSD: number; unitPriceARS: number }>) {
  const lines = items.map(
    (i) =>
      `• ${i.name} × ${i.quantity}\n  💵 USD ${(i.unitPriceUSD * i.quantity).toFixed(0)} | ARS ${(i.unitPriceARS * i.quantity).toLocaleString("es-AR")}`
  );
  const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
  const totalARS = items.reduce((s, i) => s + i.unitPriceARS * i.quantity, 0);
  return `🛒 *Tu carrito:*\n\n${lines.join("\n")}\n\n*Total: USD ${totalUSD.toFixed(0)} | ARS ${totalARS.toLocaleString("es-AR")}*`;
}

// ─── Webhook GET (verification) ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");

  const waConfig = await getWAConfig() as Record<string, string> | null;
  const storedToken = waConfig?.verifyToken ?? WA_VERIFY_TOKEN;

  if (mode === "subscribe" && token === storedToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ─── Webhook POST ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: WAWebhookBody = await req.json();
    if (body.object !== "whatsapp_business_account") return NextResponse.json({ status: "ignored" });

    const parsed = parseIncomingWebhook(body);
    const waConfig = await getWAConfig() as Record<string, string> | null;

    for (const msg of parsed) {
      const contact  = await upsertContact(msg.from, msg.contactName);
      let conversation = await findOpenConversation(contact.id);
      if (!conversation) conversation = await createConversation(contact.id);

      if (await findMessageByWAId(msg.messageId)) continue;

      // ── Handle media (image / audio) ──────────────────────────────────
      let transcribedText = msg.text;
      let inboundMeta: string | undefined;
      const rawMsg = msg.rawMessage as Record<string, unknown>;

      if (msg.type === "image") {
        const image = rawMsg.image as Record<string, string> | undefined;
        if (image?.id) {
          inboundMeta = JSON.stringify({ mediaId: image.id, caption: image.caption ?? "" });
        }
      }

      if (msg.type === "audio" && waConfig?.accessToken) {
        const audioId = (rawMsg.audio as Record<string, string> | undefined)?.id;
        if (audioId) {
          inboundMeta = JSON.stringify({ mediaId: audioId });
          try {
            const media = await downloadWAMedia(audioId, waConfig.accessToken);
            if (media) {
              const txt = await transcribeAudio(media.buffer, media.mime);
              if (txt) transcribedText = txt;
            }
          } catch (e) { console.warn("[audio transcribe]", e); }
        }
      }

      // Save inbound message
      const displayText = msg.interactivePayload
        ? `[${msg.interactivePayload.title}]`
        : (transcribedText || `[${msg.type}]`);

      const inbound = await createMessage({
        conversationId: conversation.id,
        waMessageId:    msg.messageId,
        direction:      "inbound",
        sender:         "contact",
        type:           msg.interactivePayload ? "interactive" : msg.type as "text" | "image" | "audio" | "document",
        content:        displayText,
        status:         "delivered",
        metadata:       inboundMeta,
      });

      await updateConversation(conversation.id, {
        unreadCount: ((conversation as Record<string, unknown>).unreadCount as number ?? 0) + 1,
      });

      const io = (global as unknown as GlobalWithIO).io;
      io?.to(`conversation:${conversation.id}`).emit("new-message", { conversationId: conversation.id, message: inbound });
      io?.emit("conversation-updated", { conversationId: conversation.id, updates: { unreadCount: 1 } });

      // Mark as read
      if (waConfig?.phoneNumberId && waConfig?.accessToken) {
        try {
          const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
          await wa.markAsRead(msg.messageId);
        } catch { /* ignore */ }
      }

      // ── Handle interactive replies (button_reply and list_reply) ─────────
      if (msg.interactivePayload && waConfig?.phoneNumberId && waConfig?.accessToken) {
        const buttonId = msg.interactivePayload.id;
        const wa       = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);

        // ADD PRODUCT TO CART
        if (buttonId.startsWith("cart_add_")) {
          const mongoId = buttonId.slice("cart_add_".length);
          try {
            const product: MongoProduct | null = await getMongoProductById(mongoId);
            if (product) {
              const updatedCart = await addToCart(conversation.id, {
                mongoProductId: product.id,
                name:           product.name,
                image:          product.image,
                unitPriceUSD:   product.promoPrice ?? product.price,
                unitPriceARS:   product.promoPriceARS ?? product.priceARS,
              });
              io?.to(`conversation:${conversation.id}`).emit("cart-updated", { conversationId: conversation.id, cart: updatedCart });
              const confirmText = `✅ *${product.name}* agregado al carrito!\n💵 USD ${product.promoPrice ?? product.price} | ARS ${(product.promoPriceARS ?? product.priceARS).toLocaleString("es-AR")}`;
              await wa.sendButtons(contact.phone, confirmText, [
                { id: "cart_view",    title: "🛒 Ver carrito" },
                { id: "catalog_more", title: "🔍 Seguir viendo" },
              ]);
              const confirmMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: confirmText, status: "sent" });
              io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: confirmMsg });
            }
          } catch (e) { console.error("[cart_add]", e); }
          continue;
        }

        // VIEW CART
        if (buttonId === "cart_view") {
          const cart = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ name: string; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          if (items.length > 0) {
            const cartText = buildCartText(items);
            await wa.sendButtons(contact.phone, cartText, [
              { id: "cart_confirm", title: "✅ Confirmar" },
              { id: "cart_clear",   title: "🗑️ Vaciar" },
            ]);
            const cartMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: cartText, status: "sent" });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: cartMsg });
          } else {
            await wa.sendTextMessage(contact.phone, "Tu carrito está vacío. ¡Preguntame por cualquier producto y te muestro las opciones! 😊");
          }
          continue;
        }

        // CONFIRM ORDER → ask payment method
        if (buttonId === "cart_confirm") {
          const cart  = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ name: string; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          if (!items.length) {
            await wa.sendTextMessage(contact.phone, "Tu carrito está vacío. Agregá productos primero 😊");
            continue;
          }
          const payText = `💳 *¿Cómo querés abonar?*\n\n${buildCartText(items)}`;
          try {
            await wa.sendInteractiveList(
              contact.phone,
              "Método de pago",
              payText,
              "Alta Telefonía",
              "Ver opciones",
              [{
                title: "Elegí tu método",
                rows: [
                  { id: "pay_mp",       title: "💳 MercadoPago",        description: "Link de pago instantáneo" },
                  { id: "pay_transfer", title: "🏦 Transferencia",       description: `Banco Santander · Recargo 2.5%` },
                  { id: "pay_usdt",     title: "💵 USDT TRC-20",         description: "Crypto · Red TRON" },
                  { id: "pay_cash",     title: "🏪 Efectivo en local",   description: "Retiro y pago en el local" },
                ],
              }]
            );
          } catch {
            // Fallback a botones si el list falla
            await wa.sendButtons(contact.phone, payText, [
              { id: "pay_mp",       title: "💳 MercadoPago" },
              { id: "pay_transfer", title: "🏦 Transferencia" },
              { id: "pay_cash",     title: "🏪 Efectivo/USDT" },
            ]);
          }
          const payMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: payText, status: "sent" });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: payMsg });
          continue;
        }

        // PAYMENT: MERCADOPAGO
        if (buttonId === "pay_mp") {
          const cart  = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ mongoProductId: string; name: string; image: string | null; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          try {
            const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
            const contactName = (contact as Record<string,unknown>).name as string || contact.phone;

            // 1. Crear el pedido primero para obtener el ID (external_reference para MP)
            const orderId = await createOrderInMongo({
              contactName,
              phone: contact.phone,
              items: items.map(i => ({ mongoProductId: i.mongoProductId, name: i.name, image: i.image, unitPriceUSD: i.unitPriceUSD, quantity: i.quantity })),
              totalUSD,
              paymentMethod: "mercadopago",
              notes: "Pago via MercadoPago",
            });

            // 2. Crear preferencia de MP con external_reference = orderId (precio unitario correcto)
            const { initPoint, preferenceId } = await createMPPreference(
              items.map((i) => ({ name: i.name, quantity: i.quantity, unitPriceARS: i.unitPriceARS })),
              contact.phone,
              orderId,
            );

            // 3. Guardar el preferenceId en el pedido
            await updateOrderStatus(orderId, { mpPaymentId: preferenceId } as never);

            const mpText = `💳 *Tu link de pago MercadoPago:*\n\n${initPoint}\n\n_Una vez abonado confirmamos el pedido automáticamente. ¡Gracias! 😊_`;
            await wa.sendTextMessage(contact.phone, mpText);
            const mpMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: mpText, status: "sent" });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: mpMsg });
          } catch (e) {
            console.error("[pay_mp]", e);
            await wa.sendTextMessage(contact.phone, "Hubo un error al generar el link. Por favor escribinos y te ayudamos 🙏");
          }
          continue;
        }

        // PAYMENT: TRANSFERENCIA BANCARIA (+2.5%)
        if (buttonId === "pay_transfer") {
          const cart  = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ mongoProductId: string; name: string; image: string | null; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          const baseARS  = items.reduce((s, i) => s + i.unitPriceARS * i.quantity, 0);
          const { surcharge, total } = calcTransferTotal(baseARS);
          const fARS = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
          const transferText =
            `🏦 *Datos para transferencia:*\n\n` +
            `Alias: *${TRANSFER_INFO.alias}*\n` +
            `Banco: ${TRANSFER_INFO.banco}\n` +
            `Titular: ${TRANSFER_INFO.titular}\n` +
            `CUIT: ${TRANSFER_INFO.cuit}\n\n` +
            `Subtotal: ${fARS(baseARS)}\n` +
            `Recargo 2.5%: ${fARS(surcharge)}\n` +
            `*Total a transferir: ${fARS(total)}*\n\n` +
            `_Una vez realizada la transferencia, envianos el comprobante por este chat. ¡Gracias! 😊_`;
          await wa.sendTextMessage(contact.phone, transferText);
          const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
          await createOrderInMongo({ contactName: (contact as Record<string,unknown>).name as string || contact.phone, phone: contact.phone, items: items.map(i => ({ mongoProductId: i.mongoProductId, name: i.name, image: i.image, unitPriceUSD: i.unitPriceUSD, quantity: i.quantity })), totalUSD, notes: "Pago via transferencia bancaria" });
          const trMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: transferText, status: "sent" });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: trMsg });
          continue;
        }

        // PAYMENT: USDT TRC-20
        if (buttonId === "pay_usdt") {
          const cart  = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ mongoProductId: string; name: string; image: string | null; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
          const usdtText =
            `💵 *Pago en USDT (TRC-20 / TRON):*\n\n` +
            `Dirección:\n*${USDT_INFO.address}*\n\n` +
            `*Total a enviar: ${totalUSD.toFixed(2)} USDT*\n\n` +
            `${USDT_INFO.warning}\n\n` +
            `_Una vez enviado, mandanos el hash de la transacción por este chat. ¡Gracias! 😊_`;
          await wa.sendTextMessage(contact.phone, usdtText);
          await createOrderInMongo({ contactName: (contact as Record<string,unknown>).name as string || contact.phone, phone: contact.phone, items: items.map(i => ({ mongoProductId: i.mongoProductId, name: i.name, image: i.image, unitPriceUSD: i.unitPriceUSD, quantity: i.quantity })), totalUSD, notes: "Pago via USDT TRC-20" });
          const usdtMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: usdtText, status: "sent" });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: usdtMsg });
          continue;
        }

        // PAYMENT: EFECTIVO EN LOCAL
        if (buttonId === "pay_cash") {
          const cart  = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ mongoProductId: string; name: string; image: string | null; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          const baseARS  = items.reduce((s, i) => s + i.unitPriceARS * i.quantity, 0);
          const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
          const fARS = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
          const cashText =
            `🏪 *Retiro y pago en el local*\n\n` +
            `*Total a abonar: ${fARS(baseARS)}*\n\n` +
            `Te esperamos en el local. Un asesor te va a confirmar la disponibilidad y coordinar el horario de retiro. 😊`;
          await wa.sendTextMessage(contact.phone, cashText);
          await createOrderInMongo({ contactName: (contact as Record<string,unknown>).name as string || contact.phone, phone: contact.phone, items: items.map(i => ({ mongoProductId: i.mongoProductId, name: i.name, image: i.image, unitPriceUSD: i.unitPriceUSD, quantity: i.quantity })), totalUSD, notes: "Pago en efectivo en local" });
          const cashMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: cashText, status: "sent" });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: cashMsg });
          continue;
        }

        // CLEAR CART
        if (buttonId === "cart_clear") {
          await removeFromCart(conversation.id);
          io?.to(`conversation:${conversation.id}`).emit("cart-updated", { conversationId: conversation.id, cart: null });
          await wa.sendTextMessage(contact.phone, "🗑️ Carrito vaciado. ¿En qué más te puedo ayudar?");
          continue;
        }

        // CATALOG MORE (just continue to AI flow below)
        if (buttonId === "catalog_more") {
          await wa.sendTextMessage(contact.phone, "¡Claro! ¿Qué más estás buscando?");
          continue;
        }
      }

      // ── Regular text message: intent detection + AI response ────────────
      const freshConv = await findOpenConversation(contact.id) as Record<string, unknown> | null;
      if (!freshConv?.aiEnabled || freshConv?.aiPaused) continue;

      const textForSearch = transcribedText || msg.text;

      // ── Intent detection: handle cart/payment actions from plain text ──
      if (waConfig?.phoneNumberId && waConfig?.accessToken) {
        const intent = detectIntent(textForSearch);
        const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);

        if (intent === "cart_view") {
          const cart = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ name: string; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          if (items.length > 0) {
            const cartText = buildCartText(items);
            await wa.sendButtons(contact.phone, cartText, [
              { id: "cart_confirm", title: "✅ Confirmar" },
              { id: "cart_clear",   title: "🗑️ Vaciar" },
            ]);
            const cartMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: cartText, status: "sent" });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: cartMsg });
          } else {
            const emptyText = "Tu carrito está vacío. ¡Preguntame por cualquier producto y te muestro las opciones! 😊";
            await wa.sendTextMessage(contact.phone, emptyText);
            const emptyMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: emptyText, status: "sent" });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: emptyMsg });
          }
          continue;
        }

        if (intent === "cart_confirm") {
          const cart  = await getCart(conversation.id);
          const items = (cart as Record<string, unknown>)?.items as Array<{ name: string; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
          if (!items.length) {
            const emptyText = "Tu carrito está vacío. Agregá productos primero 😊";
            await wa.sendTextMessage(contact.phone, emptyText);
            const emptyMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: emptyText, status: "sent" });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: emptyMsg });
            continue;
          }
          const payText = `💳 *¿Cómo querés abonar?*\n\n${buildCartText(items)}`;
          try {
            await wa.sendInteractiveList(
              contact.phone, "Método de pago", payText, "Alta Telefonía", "Ver opciones",
              [{ title: "Elegí tu método", rows: [
                { id: "pay_mp",       title: "💳 MercadoPago",      description: "Link de pago instantáneo" },
                { id: "pay_transfer", title: "🏦 Transferencia",     description: "Banco Santander · Recargo 2.5%" },
                { id: "pay_usdt",     title: "💵 USDT TRC-20",       description: "Crypto · Red TRON" },
                { id: "pay_cash",     title: "🏪 Efectivo en local", description: "Retiro y pago en el local" },
              ]}]
            );
          } catch {
            await wa.sendButtons(contact.phone, payText, [
              { id: "pay_mp",       title: "💳 MercadoPago" },
              { id: "pay_transfer", title: "🏦 Transferencia" },
              { id: "pay_cash",     title: "🏪 Efectivo/USDT" },
            ]);
          }
          const payMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: payText, status: "sent" });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: payMsg });
          continue;
        }

        if (intent === "cart_clear") {
          await removeFromCart(conversation.id);
          io?.to(`conversation:${conversation.id}`).emit("cart-updated", { conversationId: conversation.id, cart: null });
          const clearText = "🗑️ Carrito vaciado. ¿En qué más te puedo ayudar?";
          await wa.sendTextMessage(contact.phone, clearText);
          const clearMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: clearText, status: "sent" });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: clearMsg });
          continue;
        }
      }

      const aiConfig = await getAIConfig() as Record<string, unknown>;

      // Extract keywords and search relevant products — ONLY for actual product queries
      let relevantProducts: MongoProduct[] = [];
      if (isProductQuery(textForSearch)) {
        const keywords = extractKeywords(textForSearch);
        if (keywords.length > 0) {
          try {
            const expanded = expandKeywords(keywords);
            // Try with all keywords first (precise), fallback to fewer if no results
            let { products } = await getMongoProducts({ keywords: expanded, limit: 6, onlyAvailable: false });
            if (products.length === 0 && expanded.length > 2) {
              // Fallback: drop stop-like words, keep brand + model + part
              const coreKw = expanded.filter((k) => !/^(de|del|la|el|y|e|con|para|un|una)$/.test(k));
              const r2 = await getMongoProducts({ keywords: coreKw, limit: 6, onlyAvailable: false });
              products = r2.products;
            }
            relevantProducts = products;
          } catch (e) { console.warn("[mongo search]", e); }
        }
      }

      // Build history — product-search exchanges are excluded from context
      const rawMsgs = (freshConv.messages as Array<Record<string, unknown>>) ?? [];
      const history = buildAIHistory(rawMsgs);

      try {
        const aiText = await generateAIResponse(
          aiConfig.systemPrompt as string,
          history,
          [],
          undefined,
          aiConfig.temperature as number,
          aiConfig.maxTokens as number,
          aiConfig.includeProducts as boolean,
          aiConfig.groqApiKey as string | null,
          relevantProducts,
        );

        // Mark product-search responses so they're excluded from future history
        const msgMetadata = relevantProducts.length > 0
          ? JSON.stringify({ isProductSearch: true })
          : null;

        const aiMsg = await createMessage({
          conversationId: conversation.id,
          direction: "outbound", sender: "ai", status: "sent", content: aiText,
          metadata: msgMetadata,
        });

        // Emit to UI immediately — before WA send so it always shows even if WA fails
        io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: aiMsg });

        // Send via WhatsApp (fire and forget — errors don't block UI update)
        if (waConfig?.phoneNumberId && waConfig?.accessToken) {
          const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
          // Add "Ver carrito" button if cart has items
          try {
            const cartCheck = await getCart(conversation.id);
            const cartHasItems = ((cartCheck as Record<string,unknown>)?.items as unknown[] | undefined)?.length ?? 0;
            if (cartHasItems > 0) {
              await wa.sendButtons(contact.phone, aiText, [{ id: "cart_view", title: "🛒 Ver carrito" }]);
            } else {
              await wa.sendTextMessage(contact.phone, aiText);
            }
          } catch (e) {
            console.error("[WA sendText]", e);
            try { await wa.sendTextMessage(contact.phone, aiText); } catch { /* ignore */ }
          }

          // Product cards (max 3)
          if (relevantProducts.length > 0) {
            for (const product of relevantProducts.slice(0, 3)) {
              const caption =
                `📦 *${product.name}*\n` +
                (product.category ? `🏷️ ${product.category}\n` : "") +
                `💵 USD ${product.promoPrice ?? product.price}${product.promoPrice ? ` ~~${product.price}~~` : ""} | ARS ${(product.promoPriceARS ?? product.priceARS).toLocaleString("es-AR")}\n` +
                (product.available ? `✅ Disponible` : `❌ Sin stock`);

              const cardButtons = product.available
                ? [{ id: `cart_add_${product.id}`, title: "🛒 Agregar" }, { id: "cart_view", title: "Ver carrito" }]
                : [{ id: "catalog_more", title: "🔍 Ver más" }];

              try { await wa.sendProductCard(contact.phone, product.image, caption, cardButtons); }
              catch (e) { console.warn("[sendProductCard]", e); }

              // Save card in Firestore with image + buttons metadata so the panel can render it
              const cardMeta = JSON.stringify({
                headerImage: product.image ?? null,
                buttons: cardButtons,
                isProductSearch: true,
              });
              const cardMsg = await createMessage({
                conversationId: conversation.id,
                direction: "outbound", sender: "ai", status: "sent",
                content: caption,
                metadata: cardMeta,
              });
              io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: cardMsg });
            }
          }
        }
      } catch (e) { console.error("[AI Error]", e); }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook POST]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
