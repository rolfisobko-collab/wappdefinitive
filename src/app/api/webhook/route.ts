import { NextRequest, NextResponse } from "next/server";
import {
  upsertContact, findOpenConversation, createConversation, createMessage,
  findMessageByWAId, updateConversation, getAIConfig, getWAConfig,
  addToCart, getCart, removeFromCart,
} from "@/lib/db";
import { parseIncomingWebhook, getWAClient, WAWebhookBody, downloadWAMedia } from "@/lib/whatsapp";
import { generateAIResponse, transcribeAudio, AIMessage } from "@/lib/ai";
import { getMongoProducts, getMongoProductById, createOrderInMongo, expandKeywords, MongoProduct } from "@/lib/mongodb";
import { createMPPreference, calcTransferTotal, TRANSFER_INFO, USDT_INFO } from "@/lib/mercadopago";

const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN ?? "wapp_hub_2026";

type GlobalWithIO = {
  io?: {
    to: (r: string) => { emit: (e: string, d: unknown) => void };
    emit: (e: string, d: unknown) => void;
  };
};

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
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 6);
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

      // ── Handle audio transcription ────────────────────────────────────
      let transcribedText = msg.text;
      if (msg.type === "audio" && waConfig?.accessToken) {
        const rawMsg = msg.rawMessage as Record<string, unknown>;
        const audioId = (rawMsg.audio as Record<string, string> | undefined)?.id;
        if (audioId) {
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
        type:           msg.interactivePayload ? "interactive" : "text",
        content:        displayText,
        status:         "delivered",
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

      // ── Handle interactive button replies (cart actions) ──────────────────
      if (msg.interactivePayload?.type === "button_reply" && waConfig?.phoneNumberId && waConfig?.accessToken) {
        const buttonId = msg.interactivePayload.id;
        const wa       = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);

        // ADD PRODUCT TO CART
        if (buttonId.startsWith("cart_add_")) {
          const mongoId = buttonId.slice("cart_add_".length);
          try {
            const product: MongoProduct | null = await getMongoProductById(mongoId);
            if (product) {
              await addToCart(conversation.id, {
                mongoProductId: product.id,
                name:           product.name,
                image:          product.image,
                unitPriceUSD:   product.promoPrice ?? product.price,
                unitPriceARS:   product.promoPriceARS ?? product.priceARS,
              });
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
            const link = await createMPPreference(
              items.map((i) => ({ name: i.name, quantity: i.quantity, unitPriceARS: i.unitPriceARS * i.quantity })),
              contact.phone
            );
            const mpText = `💳 *Tu link de pago MercadoPago:*\n\n${link}\n\n_Una vez abonado te confirmamos el pedido. ¡Gracias! 😊_`;
            await wa.sendTextMessage(contact.phone, mpText);
            const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
            await createOrderInMongo({ contactName: (contact as Record<string,unknown>).name as string || contact.phone, phone: contact.phone, items: items.map(i => ({ mongoProductId: i.mongoProductId, name: i.name, image: i.image, unitPriceUSD: i.unitPriceUSD, quantity: i.quantity })), totalUSD, notes: "Pago via MercadoPago" });
            const mpMsg = await createMessage({ conversationId: conversation.id, direction: "outbound", sender: "ai", content: mpText, status: "sent" });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: mpMsg });
            await updateConversation(conversation.id, { aiPaused: true });
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
          await updateConversation(conversation.id, { aiPaused: true });
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
          await updateConversation(conversation.id, { aiPaused: true });
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
          await updateConversation(conversation.id, { aiPaused: true });
          continue;
        }

        // CLEAR CART
        if (buttonId === "cart_clear") {
          await removeFromCart(conversation.id);
          await wa.sendTextMessage(contact.phone, "🗑️ Carrito vaciado. ¿En qué más te puedo ayudar?");
          continue;
        }

        // CATALOG MORE (just continue to AI flow below)
        if (buttonId === "catalog_more") {
          await wa.sendTextMessage(contact.phone, "¡Claro! ¿Qué más estás buscando?");
          continue;
        }
      }

      // ── Regular text message: AI response + product search ───────────────
      const freshConv = await findOpenConversation(contact.id) as Record<string, unknown> | null;
      if (!freshConv?.aiEnabled || freshConv?.aiPaused) continue;

      const aiConfig = await getAIConfig() as Record<string, unknown>;

      // Extract keywords and search relevant products (use transcribed text for audio)
      const textForSearch = transcribedText || msg.text;
      const keywords = extractKeywords(textForSearch);
      let relevantProducts: MongoProduct[] = [];
      if (keywords.length > 0) {
        try {
          const expanded = expandKeywords(keywords);
          const { products } = await getMongoProducts({ keywords: expanded, limit: 5, onlyAvailable: false });
          relevantProducts = products;
        } catch (e) { console.warn("[mongo search]", e); }
      }

      // Build history
      const msgs = (freshConv.messages as Array<Record<string, unknown>>) ?? [];
      const history: AIMessage[] = msgs.map((m) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content as string,
      }));

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

        const aiMsg = await createMessage({
          conversationId: conversation.id,
          direction: "outbound", sender: "ai", status: "sent", content: aiText,
        });

        if (waConfig?.phoneNumberId && waConfig?.accessToken) {
          const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
          await wa.sendTextMessage(contact.phone, aiText);

          // Send product cards (max 3) if relevant products found
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

              try {
                await wa.sendProductCard(contact.phone, product.image, caption, cardButtons);
              } catch (e) { console.warn("[sendProductCard]", e); }
            }
          }
        }

        io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: aiMsg });
      } catch (e) { console.error("[AI Error]", e); }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook POST]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
