import "@/lib/logStore"; // activates console patch → logs visible in /logs page
import { NextRequest, NextResponse } from "next/server";
import {
  upsertContact, findOpenConversation, createConversation, createMessage,
  findMessageByWAId, updateConversation, getAIConfig, getWAConfig,
  addToCart, getCart, removeFromCart,
} from "@/lib/db";
import { parseIncomingWebhook, getWAClient, WAWebhookBody, downloadWAMedia } from "@/lib/whatsapp";
import { generateAIResponse, transcribeAudio, filterProductsByRelevance, AIMessage } from "@/lib/ai";
import { getMongoProducts, getMongoProductById, createOrderInMongo, updateOrderStatus, expandKeywords, MongoProduct } from "@/lib/mongodb";
import { buildAltaProductBotReply, buildAltaProductCaption, isAltaProductQuery, splitAltaQueries, type AltaQualityGroup } from "@/lib/altaProductBot";
import { createMPPreference, calcTransferTotal, TRANSFER_INFO, USDT_INFO } from "@/lib/mercadopago";
import { uploadImageBytesToCloudinary } from "@/lib/cloudinary";

const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN ?? "alta_wa_2026";
const DEFAULT_WA_CATALOG_ID = "3124781991061593";

type GlobalWithIO = {
  io?: {
    to: (r: string) => { emit: (e: string, d: unknown) => void };
    emit: (e: string, d: unknown) => void;
  };
};

function waMessageIdFrom(response: unknown): string | null {
  const messages = (response as { messages?: Array<{ id?: string }> } | null)?.messages;
  return messages?.[0]?.id ?? null;
}

function sendErrorSummary(error: unknown): string {
  const err = error as { code?: string; message?: string; response?: { status?: number; data?: unknown } };
  const status = err.response?.status ? `status=${err.response.status}` : null;
  const data = err.response?.data ? `data=${JSON.stringify(err.response.data).slice(0, 300)}` : null;
  return [err.code, err.message, status, data].filter(Boolean).join(" | ") || "unknown";
}

function waCatalogId(config: Record<string, string> | null): string | null {
  return config?.catalogId || process.env.WA_CATALOG_ID || DEFAULT_WA_CATALOG_ID || null;
}

function productRetailerId(product: MongoProduct): string {
  const raw = product.sku ? `sku_${product.sku}` : `id_${product.id}`;
  return raw.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100);
}

async function productFromRetailerId(retailerId: string): Promise<MongoProduct | null> {
  const sku = retailerId.match(/^sku_(\d+)$/i)?.[1];
  if (sku) {
    const result = await getMongoProducts({ search: sku, limit: 1, onlyAvailable: false });
    return result.products.find((product) => String(product.sku ?? "") === sku) ?? result.products[0] ?? null;
  }
  const mongoId = retailerId.replace(/^id_/i, "");
  return mongoId ? getMongoProductById(mongoId) : null;
}

function mergeProducts(...groups: MongoProduct[][]): MongoProduct[] {
  const seen = new Set<string>();
  return groups.flat().filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

async function sendCatalogOrProductCard(
  wa: ReturnType<typeof getWAClient>,
  to: string,
  catalogId: string | null,
  product: MongoProduct,
  caption: string,
  buttons: { id: string; title: string }[]
): Promise<{ waMessageId: string | null; deliveryMethod: string; deliveryError: string | null }> {
  if (catalogId) {
    try {
      const res = await wa.sendProductCatalog(to, catalogId, productRetailerId(product));
      return { waMessageId: waMessageIdFrom(res), deliveryMethod: "wa_catalog_product", deliveryError: null };
    } catch (catalogError) {
      const catalogSummary = sendErrorSummary(catalogError);
      console.warn(`[WH] catalog product failed sku=${product.sku ?? ""}: ${catalogSummary}`);
      try {
        const res = await wa.sendProductCard(to, product.image, caption, buttons);
        return {
          waMessageId: waMessageIdFrom(res),
          deliveryMethod: product.image ? "card_image_after_catalog_fail" : "card_buttons_after_catalog_fail",
          deliveryError: catalogSummary,
        };
      } catch (imageError) {
        const imageSummary = sendErrorSummary(imageError);
        try {
          const res = await wa.sendProductCard(to, null, caption, buttons);
          return {
            waMessageId: waMessageIdFrom(res),
            deliveryMethod: "card_buttons_after_catalog_fail",
            deliveryError: `${catalogSummary} | ${imageSummary}`,
          };
        } catch (buttonError) {
          const buttonSummary = sendErrorSummary(buttonError);
          const res = await wa.sendTextMessage(to, caption);
          return {
            waMessageId: waMessageIdFrom(res),
            deliveryMethod: "text_fallback_after_catalog_fail",
            deliveryError: `${catalogSummary} | ${imageSummary} | ${buttonSummary}`,
          };
        }
      }
    }
  }

  try {
    const res = await wa.sendProductCard(to, product.image, caption, buttons);
    return { waMessageId: waMessageIdFrom(res), deliveryMethod: product.image ? "card_image" : "card_buttons", deliveryError: null };
  } catch (imageError) {
    const imageSummary = sendErrorSummary(imageError);
    try {
      const res = await wa.sendProductCard(to, null, caption, buttons);
      return { waMessageId: waMessageIdFrom(res), deliveryMethod: "card_buttons", deliveryError: imageSummary };
    } catch (buttonError) {
      const buttonSummary = sendErrorSummary(buttonError);
      const res = await wa.sendTextMessage(to, caption);
      return { waMessageId: waMessageIdFrom(res), deliveryMethod: "text_fallback", deliveryError: `${imageSummary} | ${buttonSummary}` };
    }
  }
}

type PendingAltaSelection = {
  menuId: string;
  groups: AltaQualityGroup[];
  createdAt: number;
};

const pendingAltaSelections = new Map<string, PendingAltaSelection>();
const lastAltaQueryByConversation = new Map<string, string>();
const latestProductCardByConversation = new Map<string, string>();

function createMenuId(): string {
  return Math.random().toString(36).slice(2, 10);
}

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
    "\\b(iphone|samsung|xiaomi|motorola|oppo|realme|nokia|huawei|lg|sony|apple|poco|redmi|tcl|alcatel|nubia|itel|infinix|tecno)\\b",
    // Part types (accent-stripped)
    "\\b(pantalla|modulo|modulos|bateria|baterias|camara|camaras|visor|visores|flex|placa|placas|repuesto|repuestos|cargador|cargadores|cable|funda|vidrio|vidirio|glass|glas|tactil|auricular|parlante|bocina|microfono|boton|altavoz|tapa|tapas|carcasa|marco|chasis|lente|sensor|chip|conector|puerto|pin|pines|centro|lcd|display|touch|cristal|templado|hidrogel|lamina|memoria|memorias|microsd|micro sd|tarjeta sd|pasta|passta|termica|precalentadora|precalentadoras|herramienta|herramientas|insumo|insumos|pinza|destornillador|estano|estaño|flux|estacion|soldado|soldador|soldadura|trinocular|microscopio|hilo|jumper|malla|desoldante|wick|aifen|aife|qianli|relife|mechanic|amaoe|luowei|ycs|amtech|celular|celulares|telefono|telefonos)\\b",
    // Common search phrases
    "\\b(precio|stock|disponible|cuanto cuesta|cuanto sale|tienen|busco|necesito|quiero|conseguir)\\b.{0,40}\\b(pantalla|modulo|bateria|camara|visor|flex|placa|pin|pines|conector|puerto|repuesto|celular|telefono|memoria|cargador|pasta|precalentadora|herramienta|insumo|tapa|chasis|templado|estacion|soldador|hilo|malla|trinocular)\\b",
  ].join("|"),
  "i"
);

function isProductQuery(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return PRODUCT_INTENT_RE.test(normalized);
}

const PRODUCT_FOLLOWUP_RE = /\b(modelo|valor|precio|sale|cuesta|stock|disponible|disponibilidad|calidad|calidades|ese|esa|este|esta|primero|primera|segundo|segunda|opcion|opciones|sku|codigo|cod)\b|#?\b\d{3,6}\b/i;
const CATALOG_AFFIRMATIVE_FOLLOWUP_RE = /\b(si|s[ií]|dale|ok|okay|mostrame|mostrar|muestrame|mandame|pasame|ver|quiero|alternativas|opciones)\b/i;
const COLOR_FOLLOWUP_RE = /\b(color|colores|blanco|blanca|negro|negra|rojo|roja|azul|celeste|rosa|rosado|rosada|dorado|dorada|lila|violeta|purpura|púrpura|verde|gris|amarillo|amarilla|naranja|plateado|plateada|grafito|beige)\b/i;

function isCatalogLikeMessage(text: string): boolean {
  return isProductQuery(text) || isAltaProductQuery(text) || PRODUCT_FOLLOWUP_RE.test(text);
}

function isCatalogFollowUp(text: string): boolean {
  return (PRODUCT_FOLLOWUP_RE.test(text) || CATALOG_AFFIRMATIVE_FOLLOWUP_RE.test(text) || COLOR_FOLLOWUP_RE.test(text)) && !isProductQuery(text) && !isAltaProductQuery(text);
}

function shouldProbeCatalogMetadata(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(hola|buenas|buen dia|buenas tardes|buenas noches)\s+(nova|bot|ia|alta)?$/.test(normalized)) return false;
  if (normalized.length < 4 && !/^\d{2,}$/.test(normalized)) return false;
  if (/^(hola|buenas|buen dia|buenas tardes|buenas noches|gracias|ok|dale|si|no)$/.test(normalized)) return false;
  return normalized.split(/\s+/).some((word) => word.length >= 4 || /\d/.test(word));
}

function recentCatalogQuery(messages: Array<Record<string, unknown>>, currentText: string): string | null {
  let skippedCurrent = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.direction !== "inbound") continue;
    const content = String(m.content ?? "").trim();
    if (!content || content.startsWith("[")) continue;
    if (content === currentText && !skippedCurrent) {
      skippedCurrent = true;
      continue;
    }
    if (isProductQuery(content) || isAltaProductQuery(content)) return content;
  }
  return null;
}

async function resolveAltaPickFromHistory(
  menuId: string,
  pickValue: string,
  messages: Array<Record<string, unknown>>
): Promise<MongoProduct | null> {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.direction !== "outbound" || !m.metadata) continue;
    try {
      const meta = JSON.parse(String(m.metadata)) as {
        altaBot?: string;
        menuId?: string;
        selectionMap?: Record<string, string>;
      };
      if (meta.altaBot === "quality_menu") {
        if (meta.menuId !== menuId) return null;
        const mappedId = meta.selectionMap?.[pickValue] ?? pickValue;
        return await getMongoProductById(mappedId);
      }
    } catch { /* ignore malformed metadata */ }
  }
  return null;
}

function parseAltaPickId(buttonId: string): { menuId: string | null; productId: string | null } {
  const pickValue = buttonId.slice("alta_pick_".length);
  const separator = pickValue.indexOf("_");
  if (separator <= 0) return { menuId: null, productId: null };
  return {
    menuId: pickValue.slice(0, separator),
    productId: pickValue.slice(separator + 1),
  };
}

function latestProductCardFromHistory(messages: Array<Record<string, unknown>>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.direction !== "outbound" || !m.metadata) continue;
    try {
      const meta = JSON.parse(String(m.metadata)) as { productId?: string; altaBot?: string };
      if (meta.productId && ["direct", "pick"].includes(meta.altaBot ?? "")) return meta.productId;
      if (meta.altaBot === "quality_menu") return null;
    } catch { /* ignore malformed metadata */ }
  }
  return null;
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
  "precio", "precios", "unidad", "unidades",
  // "stock" y "disponible" se conservan porque ayudan a detectar consultas de disponibilidad.
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
  return filtered.slice(0, 8);
}

// ─── Multi-product query splitter ────────────────────────────────────────────
// Splits "modulo iphone 13 y 13 pro max" into two searches:
// ["modulo iphone 13", "modulo iphone 13 pro max"]
function splitProductQueries(text: string): string[] {
  const norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Split on connectors — soporta N productos, sin límite
  const parts = norm.split(/\s+[y,]\s+|\s+tambien\s+|\s+ademas\s+|\s+mas\s+|\s+\+\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return [norm];

  // Detect the "part" keyword (modulo, bateria, etc.) from the first segment
  // and prepend it to subsequent segments if they don't already have a part keyword
  const PART_RE = /\b(modulo|pantalla|bateria|camara|flex|placa|repuesto|cargador|vidrio|tactil|lcd|display|touch|tapa|carcasa)\b/;
  const BRAND_RE = /\b(iphone|samsung|xiaomi|motorola|oppo|realme|nokia|huawei|lg|sony|apple|poco|redmi)\b/;

  const firstPartMatch = parts[0].match(PART_RE)?.[0];
  const firstBrandMatch = parts[0].match(BRAND_RE)?.[0];

  return parts.map((p, i) => {
    if (i === 0) return p;
    let q = p;
    // If subsequent segment has no part keyword, prepend from first
    if (firstPartMatch && !PART_RE.test(q)) q = `${firstPartMatch} ${q}`;
    // If subsequent segment has no brand, prepend from first
    if (firstBrandMatch && !BRAND_RE.test(q)) q = `${firstBrandMatch} ${q}`;
    return q;
  });
}

// ─── Keyword → category hint ──────────────────────────────────────────────────
// Maps part-type keywords to MongoDB stockCategories names (partial match)
const CATEGORY_HINTS: Record<string, string> = {
  bateria: "bater",
  battery: "bater",
  modulo: "modulo",
  pantalla: "modulo",
  display: "modulo",
  lcd: "modulo",
  visor: "visor de camara",
  visores: "visor de camara",
  vidrio: "visor de camara",
  camara: "camara",
  camera: "camara",
  lente: "visor de camara",
  flex: "flex",
  placa: "placa",
  board: "placa",
  tapa: "tapa",
  carcasa: "tapa",
  chasis: "chasis",
  marco: "chasis",
  cargador: "cargador",
  cargadores: "cargador",
  charger: "cargador",
  memoria: "memoria",
  memorias: "memoria",
  microsd: "memoria",
  sd: "memoria",
  pasta: "herramienta",
  passta: "herramienta",
  estano: "herramienta",
  estaño: "herramienta",
  termica: "herramienta",
  precalentadora: "herramienta",
  precalentadoras: "herramienta",
  estacion: "herramienta",
  soldado: "herramienta",
  soldador: "herramienta",
  soldadura: "herramienta",
  trinocular: "herramienta",
  microscopio: "herramienta",
  hilo: "herramienta",
  jumper: "herramienta",
  malla: "herramienta",
  desoldante: "herramienta",
  wick: "herramienta",
  aifen: "herramienta",
  aife: "herramienta",
  qianli: "herramienta",
  relife: "herramienta",
  mechanic: "herramienta",
  amaoe: "herramienta",
  luowei: "herramienta",
  ycs: "herramienta",
  amtech: "herramienta",
  herramienta: "herramienta",
  herramientas: "herramienta",
  insumo: "herramienta",
  insumos: "herramienta",
  templado: "accesorio",
  hidrogel: "accesorio",
  lamina: "accesorio",
  glass: "glass",
  glas: "glass",
  vidirio: "glass",
  auricular: "auricular",
  parlante: "auricular",
};

function detectCategoryHint(keywords: string[]): string | null {
  for (const kw of keywords) {
    const norm = kw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (CATEGORY_HINTS[norm]) return CATEGORY_HINTS[norm];
  }
  return null;
}

// ─── Cart message builder ────────────────────────────────────────────────────

function buildCartText(items: Array<{ name: string; quantity: number; unitPriceUSD: number; unitPriceARS: number }>) {
  const fARS = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
  const lines = items.map(
    (i) =>
      `• ${i.name} × ${i.quantity}\n  💵 ${fARS(i.unitPriceARS * i.quantity)}`
  );
  const totalARS = items.reduce((s, i) => s + i.unitPriceARS * i.quantity, 0);
  return `🛒 *Tu carrito:*\n\n${lines.join("\n")}\n\n*Total: ${fARS(totalARS)}*`;
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

    const waConfig = await getWAConfig() as Record<string, string> | null;
    const expectedPhoneNumberId = waConfig?.phoneNumberId;
    const eventPhoneNumberIds = new Set(
      (body.entry ?? [])
        .flatMap((entry) => entry.changes ?? [])
        .map((change) => change.value?.metadata?.phone_number_id)
        .filter(Boolean)
    );

    if (
      expectedPhoneNumberId &&
      eventPhoneNumberIds.size > 0 &&
      !eventPhoneNumberIds.has(expectedPhoneNumberId)
    ) {
      console.warn(
        `[WH] ignored phone_number_id mismatch expected=${expectedPhoneNumberId} got=${[
          ...eventPhoneNumberIds,
        ].join(",")}`
      );
      return NextResponse.json({ status: "ignored", reason: "phone_number_id_mismatch" });
    }

    const parsed = parseIncomingWebhook(body);

    for (const msg of parsed) {
      console.log(`[WH] ▶ from=${msg.from} type=${msg.type} text=${JSON.stringify(msg.text?.slice(0,80))}`);
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
          let cloudinaryUrl: string | null = null;
          if (waConfig?.accessToken) {
            try {
              const media = await downloadWAMedia(image.id, waConfig.accessToken);
              if (media) {
                const upload = await uploadImageBytesToCloudinary(media.buffer, media.mime, `${image.id}.jpg`);
                cloudinaryUrl = upload.secureUrl;
              }
            } catch (e) {
              console.warn("[image cloudinary cache]", e);
            }
          }
          inboundMeta = JSON.stringify({ mediaId: image.id, caption: image.caption ?? "", cloudinaryUrl });
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
              if (txt) {
                transcribedText = txt;
                console.log(`[WH] 🎤 audio transcripto: ${JSON.stringify(txt)}`);
              }
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
      if (msg.type === "order" && waConfig?.phoneNumberId && waConfig?.accessToken) {
        const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
        const raw = msg.rawMessage as {
          order?: {
            catalog_id?: string;
            product_items?: Array<{
              product_retailer_id?: string;
              quantity?: string | number;
            }>;
          };
        };
        const orderItems = raw.order?.product_items ?? [];
        const added: string[] = [];
        const missing: string[] = [];

        for (const item of orderItems) {
          const retailerId = String(item.product_retailer_id ?? "");
          const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
          const product = retailerId ? await productFromRetailerId(retailerId) : null;
          if (!product) {
            missing.push(retailerId || "sin_id");
            continue;
          }
          await addToCart(conversation.id, {
            mongoProductId: product.id,
            name: product.name,
            image: product.image,
            unitPriceUSD: product.promoPrice ?? product.price,
            unitPriceARS: product.promoPriceARS ?? product.priceARS,
          }, quantity);
          added.push(`${product.name} x ${quantity}`);
        }

        const updatedCart = await getCart(conversation.id);
        io?.to(`conversation:${conversation.id}`).emit("cart-updated", { conversationId: conversation.id, cart: updatedCart });

        const items = (updatedCart as Record<string, unknown> | null)?.items as Array<{ name: string; quantity: number; unitPriceUSD: number; unitPriceARS: number }> ?? [];
        const cartText = items.length
          ? `${buildCartText(items)}\n\nRecibi tu carrito de WhatsApp. Confirmalo para elegir forma de pago.`
          : "Recibi el pedido de WhatsApp, pero no pude vincular los productos al catalogo interno.";
        const sendText = missing.length ? `${cartText}\n\nNo pude vincular: ${missing.join(", ")}` : cartText;
        await wa.sendButtons(contact.phone, sendText, items.length
          ? [{ id: "cart_confirm", title: "Confirmar" }, { id: "cart_clear", title: "Vaciar" }]
          : [{ id: "catalog_more", title: "Buscar de nuevo" }]
        );
        const orderMsg = await createMessage({
          conversationId: conversation.id,
          direction: "outbound",
          sender: "ai",
          content: sendText,
          status: "sent",
          metadata: JSON.stringify({ isProductSearch: true, altaBot: "wa_catalog_order", catalogId: raw.order?.catalog_id, added, missing }),
        });
        io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: orderMsg });
        continue;
      }

      if (msg.interactivePayload && waConfig?.phoneNumberId && waConfig?.accessToken) {
        const buttonId = msg.interactivePayload.id;
        const wa       = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);

        // ALTA PRODUCT QUALITY PICK
        if (buttonId.startsWith("alta_pick_")) {
          const { menuId, productId } = parseAltaPickId(buttonId);
          const pending = pendingAltaSelections.get(conversation.id);
          const product = menuId && productId && pending?.menuId === menuId
            ? pending.groups.flatMap((group) => group.products).find((p) => p.id === productId) ?? await getMongoProductById(productId)
            : menuId && productId
              ? await resolveAltaPickFromHistory(menuId, productId, (conversation as Record<string, unknown>).messages as Array<Record<string, unknown>> ?? [])
              : null;

          if (product) {
            const caption = buildAltaProductCaption(product);
            const cardButtons = product.available
              ? [{ id: `cart_add_${product.id}`, title: "Agregar" }, { id: "cart_view", title: "Ver carrito" }]
              : [{ id: "catalog_more", title: "Ver mas" }];
            const delivery = await sendCatalogOrProductCard(
              wa,
              contact.phone,
              waCatalogId(waConfig),
              product,
              caption,
              cardButtons
            );

            const cardMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound",
              sender: "ai",
              status: "sent",
              waMessageId: delivery.waMessageId,
              content: caption,
              metadata: JSON.stringify({
                productId: product.id,
                headerImage: product.image ?? null,
                buttons: cardButtons,
                isProductSearch: true,
                altaBot: "pick",
                catalogId: waCatalogId(waConfig),
                productRetailerId: productRetailerId(product),
                deliveryMethod: delivery.deliveryMethod,
                deliveryError: delivery.deliveryError,
              }),
            });
            latestProductCardByConversation.set(conversation.id, product.id);
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: cardMsg });
          } else {
            const text = "Esa opcion ya no esta vigente. Escribime de nuevo el producto y te muestro las opciones actualizadas.";
            const res = await wa.sendTextMessage(contact.phone, text);
            const outMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound",
              sender: "ai",
              status: "sent",
              waMessageId: waMessageIdFrom(res),
              content: text,
              metadata: JSON.stringify({ isProductSearch: true, altaBot: "stale_pick", menuId, productId, pickTitle: msg.interactivePayload.title }),
            });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: outMsg });
          }
          continue;
        }

        // ADD PRODUCT TO CART
        if (buttonId.startsWith("cart_add_")) {
          const mongoId = buttonId.slice("cart_add_".length);
          try {
            const latestProductId = latestProductCardByConversation.get(conversation.id)
              ?? latestProductCardFromHistory((conversation as Record<string, unknown>).messages as Array<Record<string, unknown>> ?? []);
            if (latestProductId !== mongoId) {
              const staleText = "Ese boton de agregar ya no esta vigente. Volve a buscar el producto y agregalo desde la ficha actual.";
              await wa.sendTextMessage(contact.phone, staleText);
              const staleMsg = await createMessage({
                conversationId: conversation.id,
                direction: "outbound",
                sender: "ai",
                content: staleText,
                status: "sent",
                metadata: JSON.stringify({ isProductSearch: true, altaBot: "stale_cart_add", productId: mongoId, latestProductId }),
              });
              io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: staleMsg });
              continue;
            }
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
              const confirmText = `✅ *${product.name}* agregado al carrito!\n💵 ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(product.promoPriceARS ?? product.priceARS)}`;
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

      const rawMsgs = (freshConv.messages as Array<Record<string, unknown>>) ?? [];
      const rememberedQuery = lastAltaQueryByConversation.get(conversation.id) ?? recentCatalogQuery(rawMsgs, textForSearch);
      const isRememberedFollowUp = Boolean(rememberedQuery) && isCatalogFollowUp(textForSearch);
      let metadataCatalogHit = false;
      if (!isCatalogLikeMessage(textForSearch) && shouldProbeCatalogMetadata(textForSearch)) {
        const probe = await getMongoProducts({ search: textForSearch, limit: 1, onlyAvailable: false });
        metadataCatalogHit = probe.products.length > 0;
      }
      const forceCatalogBot = isCatalogLikeMessage(textForSearch) || metadataCatalogHit || isRememberedFollowUp;
      const altaQuery = isRememberedFollowUp
        ? rememberedQuery as string
        : textForSearch;

      // Alta deterministic product bot. Product/price/stock messages never fall through to free AI.
      try {
        if (forceCatalogBot) {
          const splitQueries = splitAltaQueries(textForSearch);
          if (!isRememberedFollowUp && splitQueries.length > 1) {
            const catalogResult = await getMongoProducts({ limit: 5000, onlyAvailable: false });
            const responses: string[] = [];

            for (const query of splitQueries) {
              const queryResult = await getMongoProducts({ search: query, limit: 150, onlyAvailable: false });
              const products = mergeProducts(queryResult.products, catalogResult.products);
              const reply = buildAltaProductBotReply(products, query, true);
              if (reply.mode === "direct") {
                responses.push(`*${query}*\n${buildAltaProductCaption(reply.product)}`);
              } else if (reply.mode === "quality_menu") {
                responses.push(`*${query}*\n${reply.text}`);
              } else if ("text" in reply) {
                responses.push(`*${query}*\n${reply.text}`);
              }
            }

            pendingAltaSelections.delete(conversation.id);
            latestProductCardByConversation.delete(conversation.id);
            const multiText = `${responses.join("\n\n---\n\n")}\n\nPara elegir/agregar, mandame una busqueda por vez asi te paso la ficha exacta.`;
            const outMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound",
              sender: "ai",
              status: "sent",
              content: multiText,
              metadata: JSON.stringify({ isProductSearch: true, altaBot: "multi_query", count: splitQueries.length }),
            });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: outMsg });
            if (waConfig?.phoneNumberId && waConfig?.accessToken) {
              const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
              await wa.sendTextMessage(contact.phone, multiText);
            }
            continue;
          }

          const [catalogResult, queryResult] = await Promise.all([
            getMongoProducts({ limit: 5000, onlyAvailable: false }),
            getMongoProducts({ search: altaQuery, limit: 150, onlyAvailable: false }),
          ]);
          const products = mergeProducts(queryResult.products, catalogResult.products);
          const altaReply = buildAltaProductBotReply(products, altaQuery, metadataCatalogHit);

          pendingAltaSelections.delete(conversation.id);

          if (altaReply.mode === "ai") {
            const safeText = rememberedQuery
              ? `No tengo datos suficientes para resolver eso con el catalogo. Decime la pieza, marca y modelo exacto, o pasame el SKU.`
              : `Decime que producto buscas con marca, modelo y pieza. Por ejemplo: "modulo samsung a52" o pasame el SKU.`;
            const outMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound",
              sender: "ai",
              status: "sent",
              content: safeText,
              metadata: JSON.stringify({ isProductSearch: true, altaBot: "safe_clarify" }),
            });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: outMsg });
            if (waConfig?.phoneNumberId && waConfig?.accessToken) {
              const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
              await wa.sendTextMessage(contact.phone, safeText);
            }
            continue;
          }

          if (altaReply.mode === "clarify" || altaReply.mode === "not_found") {
            lastAltaQueryByConversation.set(conversation.id, altaQuery);
            latestProductCardByConversation.delete(conversation.id);
            const outMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound",
              sender: "ai",
              status: "sent",
              content: altaReply.text,
              metadata: JSON.stringify({ isProductSearch: true, altaBot: altaReply.mode }),
            });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: outMsg });
            if (waConfig?.phoneNumberId && waConfig?.accessToken) {
              const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
              await wa.sendTextMessage(contact.phone, altaReply.text);
            }
            continue;
          }

          if (altaReply.mode === "quality_menu") {
            lastAltaQueryByConversation.set(conversation.id, altaQuery);
            latestProductCardByConversation.delete(conversation.id);
            const menuId = createMenuId();
            pendingAltaSelections.set(conversation.id, { menuId, groups: altaReply.groups, createdAt: Date.now() });
            const selectionMap = Object.fromEntries(
              altaReply.groups.map((group) => {
                const product = group.products[0];
                return [product.id, product.id];
              })
            );
            const selectionTitles = Object.fromEntries(
              altaReply.groups.map((group, index) => {
                const product = group.products[0];
                return [product.id, `${index + 1}. ${group.label}`.slice(0, 24)];
              })
            );
            const outMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound",
              sender: "ai",
              status: "sent",
              content: altaReply.text,
              metadata: JSON.stringify({ isProductSearch: true, altaBot: "quality_menu", menuId, selectionMap, selectionTitles }),
            });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: outMsg });

            if (waConfig?.phoneNumberId && waConfig?.accessToken) {
              const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
              const catalogId = waCatalogId(waConfig);
              const menuProducts = altaReply.groups.map((group) => group.products[0]).filter(Boolean);
              if (catalogId && menuProducts.length) {
                try {
                  await wa.sendProductCatalogList(
                    contact.phone,
                    catalogId,
                    "Productos encontrados",
                    "Te paso las opciones disponibles. Podes abrirlas y agregarlas al carrito de WhatsApp.",
                    [{ title: "Opciones", productIds: menuProducts.slice(0, 30).map(productRetailerId) }]
                  );
                  continue;
                } catch (catalogError) {
                  console.warn(`[WH] catalog product_list failed: ${sendErrorSummary(catalogError)}`);
                }
              }
              await wa.sendInteractiveList(
                contact.phone,
                "Elegir calidad",
                altaReply.text,
                "Alta Telefonia",
                "Ver calidades",
                [{
                  title: "Calidades disponibles",
                  rows: altaReply.groups.map((group, index) => {
                    const product = group.products[0];
                    return {
                      id: `alta_pick_${menuId}_${product.id}`,
                      title: `${index + 1}. ${group.label}`.slice(0, 24),
                      description: `${product.name} - ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(product.promoPriceARS ?? product.priceARS)}`.slice(0, 72),
                    };
                  }),
                }]
              );
            }
            continue;
          }

          if (altaReply.mode === "direct") {
            lastAltaQueryByConversation.set(conversation.id, altaQuery);
            const product = altaReply.product;
            const caption = buildAltaProductCaption(product);
            const cardButtons = product.available
              ? [{ id: `cart_add_${product.id}`, title: "Agregar" }, { id: "cart_view", title: "Ver carrito" }]
              : [{ id: "catalog_more", title: "Ver mas" }];
            let waMessageId: string | null = null;
            let deliveryMethod = "panel_only";
            let deliveryError: string | null = null;

            if (waConfig?.phoneNumberId && waConfig?.accessToken) {
              const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
              console.log(`[WH] sending catalog/card sku=${product.sku ?? ""} to=${contact.phone}`);
              const delivery = await sendCatalogOrProductCard(
                wa,
                contact.phone,
                waCatalogId(waConfig),
                product,
                caption,
                cardButtons
              );
              waMessageId = delivery.waMessageId;
              deliveryMethod = delivery.deliveryMethod;
              deliveryError = delivery.deliveryError;
              console.log(`[WH] catalog/card sent method=${deliveryMethod} waMessageId=${waMessageId ?? ""}`);
            }

            const cardMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound",
              sender: "ai",
              status: deliveryMethod === "failed" ? "error" : "sent",
              waMessageId,
              content: caption,
              metadata: JSON.stringify({
                productId: product.id,
                headerImage: product.image ?? null,
                buttons: cardButtons,
                isProductSearch: true,
                altaBot: "direct",
                catalogId: waCatalogId(waConfig),
                productRetailerId: productRetailerId(product),
                deliveryMethod,
                deliveryError,
              }),
            });
            latestProductCardByConversation.set(conversation.id, product.id);
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: cardMsg });
            continue;
          }
        }
      } catch (e) {
        console.error("[alta product bot]", e);
        if (forceCatalogBot) {
          const safeText = "No pude consultar el catalogo en este momento. Probame de nuevo en unos instantes.";
          const outMsg = await createMessage({
            conversationId: conversation.id,
            direction: "outbound",
            sender: "ai",
            status: "sent",
            content: safeText,
            metadata: JSON.stringify({ isProductSearch: true, altaBot: "catalog_error" }),
          });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: outMsg });
          if (waConfig?.phoneNumberId && waConfig?.accessToken) {
            const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
            await wa.sendTextMessage(contact.phone, safeText);
          }
          continue;
        }
      }

      const aiConfig = await getAIConfig() as Record<string, unknown>;

      // Extract keywords and search relevant products — ONLY for actual product queries
      let relevantProducts: MongoProduct[] = [];
      // Map each query string to its found products (for searching labels)
      const searchQueries: Array<{ label: string; products: MongoProduct[] }> = [];

      if (isProductQuery(textForSearch)) {
        const queries = splitProductQueries(textForSearch);
        console.log(`[WH] 🔍 product query detected, sub-queries=${queries.length}:`, queries);
        for (const q of queries) {
          const keywords = extractKeywords(q);
          if (keywords.length === 0) { console.log(`[WH] ⚠️  no keywords for query: ${q}`); continue; }
          console.log(`[WH] 🔑 keywords=[${keywords.join(",")}] for q=${JSON.stringify(q)}`);
          try {
            const catHint = detectCategoryHint(keywords);
            const { categories } = await getMongoProducts({ limit: 1 });
            const matchedCat = catHint
              ? categories.find(c => c.name.toLowerCase().includes(catHint))
              : null;
            const categoryId = matchedCat?.id ?? undefined;
            console.log(`[WH] 🏷️  catHint=${catHint} matchedCat=${matchedCat?.name ?? "none"} categoryId=${categoryId ?? "none"}`);

            // 1. Atlas Search con keywords + categoría si se detectó
            let { products } = await getMongoProducts({ keywords, limit: 5, onlyAvailable: false, categoryId });
            console.log(`[WH] [1] Atlas+cat results=${products.length}:`, products.map(p=>p.name));
            // 2. Sin filtro de categoría si no encontró nada
            if (products.length === 0 && categoryId) {
              const r1b = await getMongoProducts({ keywords, limit: 5, onlyAvailable: false });
              products = r1b.products;
              console.log(`[WH] [2] Atlas sin cat results=${products.length}:`, products.map(p=>p.name));
            }
            // 3. Fallback AND regex con expansión si sigue sin resultados
            if (products.length === 0) {
              const expanded = expandKeywords(keywords);
              const r2 = await getMongoProducts({ keywords: expanded, limit: 5, onlyAvailable: false, exact: true, categoryId });
              products = r2.products;
              console.log(`[WH] [3] regex expanded results=${products.length}:`, products.map(p=>p.name));
            }
            // 4. Sin número de modelo si sigue sin resultados
            if (products.length === 0 && keywords.some(k => /^\d+$/.test(k))) {
              const noNum = keywords.filter(k => !/^\d+$/.test(k));
              if (noNum.length > 0) {
                const r3 = await getMongoProducts({ keywords: noNum, limit: 5, onlyAvailable: false, categoryId });
                products = r3.products;
                console.log(`[WH] [4] no-num results=${products.length}:`, products.map(p=>p.name));
              }
            }
            console.log(`[WH] 🤖 AI validation input=${products.length} products for query=${JSON.stringify(q)}`);
            const filtered = await filterProductsByRelevance(q, products, aiConfig?.groqApiKey as string | null);
            console.log(`[WH] ✅ AI kept=${filtered.length}/${products.length}:`, filtered.map(p=>p.name));
            const newProds = filtered.filter(p => !relevantProducts.find(r => r.id === p.id));
            const label = matchedCat
              ? `${keywords.join(" ")} (en ${matchedCat.name})`
              : keywords.join(" ");
            searchQueries.push({ label, products: newProds });
            relevantProducts.push(...newProds);
          } catch (e) { console.error("[WH] ❌ mongo search error:", e); }
        }
      }

      // Build history — product-search exchanges are excluded from context
      const history = buildAIHistory(rawMsgs);

      try {
        const hasProductResults = relevantProducts.length > 0;
        console.log(`[WH] hasProductResults=${hasProductResults} total=${relevantProducts.length}`);

        if (!hasProductResults) {
          const aiText = await generateAIResponse(
            aiConfig.systemPrompt as string,
            history,
            [],
            undefined,
            aiConfig.temperature as number,
            aiConfig.maxTokens as number,
            false,
            aiConfig.groqApiKey as string | null,
            [],
          );

          console.log(`[WH] 🤖 AI response: ${JSON.stringify(aiText.slice(0, 200))}`);
          const aiMsg = await createMessage({
            conversationId: conversation.id,
            direction: "outbound", sender: "ai", status: "sent", content: aiText,
            metadata: null,
          });
          io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: aiMsg });

          if (waConfig?.phoneNumberId && waConfig?.accessToken) {
            console.log(`[WH] 💬 sending AI text to ${contact.phone}, len=${aiText.length}`);
            const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);
            try {
              const cartCheck = await getCart(conversation.id);
              const cartHasItems = ((cartCheck as Record<string,unknown>)?.items as unknown[] | undefined)?.length ?? 0;
              if (cartHasItems > 0) {
                await wa.sendButtons(contact.phone, aiText, [{ id: "cart_view", title: "🛒 Ver carrito" }]);
              } else {
                await wa.sendTextMessage(contact.phone, aiText);
              }
              console.log(`[WH] ✅ AI text sent OK`);
            } catch (e) {
              console.error("[WH] ❌ WA sendText error:", e);
              try { await wa.sendTextMessage(contact.phone, aiText); } catch(e2) { console.error("[WH] ❌ WA sendText retry error:", e2); }
            }
          }
        }

        // Send via WhatsApp product cards
        if (hasProductResults && waConfig?.phoneNumberId && waConfig?.accessToken) {
          const wa = getWAClient(waConfig.phoneNumberId, waConfig.accessToken);

          // "Buscando..." label per query group — only if products found
          for (const sq of searchQueries) {
            if (sq.products.length === 0) continue;
            const searchLabel = `🔍 *Buscando:* ${sq.label}`;
            const searchLabelMsg = await createMessage({
              conversationId: conversation.id,
              direction: "outbound", sender: "ai", status: "sent",
              content: searchLabel,
              metadata: JSON.stringify({ isProductSearch: true }),
            });
            io?.to(`conversation:${conversation.id}`).emit("ai-response", { conversationId: conversation.id, message: searchLabelMsg });
            try { await wa.sendTextMessage(contact.phone, searchLabel); } catch { /* ignore */ }
          }

          for (const product of relevantProducts.slice(0, 6)) {
              const caption =
                `📦 *${product.name}*\n` +
                (product.sku ? `🔢 SKU: ${product.sku}\n` : "") +
                (product.category ? `🏷️ ${product.category}\n` : "") +
                (product.partBrand ? `🔧 Marca repuesto: ${product.partBrand}\n` : "") +
                (product.deviceModel ? `📱 Modelo: ${product.deviceModel}\n` : "") +
                (product.tags?.length ? `🔑 ${product.tags.join(", ")}\n` : "") +
                `💵 ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(product.promoPriceARS ?? product.priceARS)}${product.promoPriceARS ? ` (antes ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(product.priceARS)})` : ""}\n` +
                (product.available ? `✅ Disponible` : `❌ Sin stock`);

              const cardButtons = product.available
                ? [{ id: `cart_add_${product.id}`, title: "🛒 Agregar" }, { id: "cart_view", title: "Ver carrito" }]
                : [{ id: "catalog_more", title: "🔍 Ver más" }];

              console.log(`[WH] 📤 sending card to=${contact.phone} sku=${product.sku} img=${product.image?.slice(0,60) ?? "null"} captionLen=${caption.length}`);
              try {
                await wa.sendProductCard(contact.phone, product.image, caption, cardButtons);
                console.log(`[WH] ✅ card sent OK: ${product.name}`);
              } catch (cardErr: unknown) {
                const axiosData = (cardErr as Record<string,unknown>)?.response as Record<string,unknown> | undefined;
                console.error(`[WH] ❌ card FAILED: ${product.name}`, {
                  message: cardErr instanceof Error ? cardErr.message : String(cardErr),
                  status: axiosData?.status,
                  data: JSON.stringify(axiosData?.data ?? "").slice(0, 400),
                });
                if (product.image) {
                  console.log(`[WH] 🔄 retrying card without image: ${product.name}`);
                  try {
                    await wa.sendProductCard(contact.phone, null, caption, cardButtons);
                    console.log(`[WH] ✅ card sent OK (no image): ${product.name}`);
                  } catch (noImgErr: unknown) {
                    const d2 = (noImgErr as Record<string,unknown>)?.response as Record<string,unknown> | undefined;
                    console.error(`[WH] ❌ card FAILED even without image:`, {
                      message: noImgErr instanceof Error ? noImgErr.message : String(noImgErr),
                      status: d2?.status,
                      data: JSON.stringify(d2?.data ?? "").slice(0, 400),
                    });
                  }
                }
              }

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
      } catch (e) { console.error("[AI Error]", e); }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook POST]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
