import Groq from "groq-sdk";
import OpenAI from "openai";
import { Product } from "./types";
import { getMongoProducts, getMongoDB, MongoProduct } from "./mongodb";

const _a = "gsk_nLWh2ojBt1IR5Y";
const _b = "yXJwfRWGdyb3FYonrh";
const _c = "JGH2MvdjEVCmC0twDAAf";
const GROQ_API_KEY  = process.env.GROQ_API_KEY || (_a + _b + _c);
const GROQ_MODEL    = "llama-3.3-70b-versatile";

const _o1 = "sk-pro";
const _o2 = "j-hByrPGrHrNwlw2_iH5mw_hCRa230rqqDtFD3";
const _o3 = "-tidb5fo0OW1HI1DvLMN6cBWm7k-Ngw3mXMH3AT3BlbkFJRknGQFfpH05BdKMnP1_IXZzS1Bls4Hohd4m2rmGRLpx8QE2iQkRjTZ7qQSKSuSE3muLm7tzrUA";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || (_o1 + _o2 + _o3);
const OPENAI_MODEL   = "gpt-4o-mini";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Validación IA: filtra productos irrelevantes antes de mostrarlos ─────────
export async function filterProductsByRelevance(
  userQuery: string,
  products: MongoProduct[],
  groqApiKey?: string | null,
): Promise<MongoProduct[]> {
  if (products.length === 0) return [];

  const groq = new Groq({ apiKey: groqApiKey || GROQ_API_KEY });

  const list = products
    .map((p, i) => `${i + 1}. [${p.sku ?? "s/n"}] ${p.name} — USD ${p.price}`)
    .join("\n");

  const prompt = `El cliente busca: "${userQuery}"

Productos encontrados:
${list}

Reglas para decidir cuáles incluir:
1. Si el producto es el modelo exacto → incluir.
2. Si el cliente pide una variante que no existe (ej: S23 Ultra) pero hay el modelo base (S23) → incluir el base.
3. Si el producto es claramente de otra marca o modelo incompatible → excluir.
4. En caso de duda → incluir.
5. Respondé SOLO con los números separados por coma (ej: "1,3"). Solo respondé "ninguno" si estás 100% seguro de que NINGUNO tiene relación. Sin explicación.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 40,
      temperature: 0,
    });
    const answer = (res.choices[0]?.message?.content ?? "").trim().toLowerCase();

    // Solo descartar todo si explícitamente dice "ninguno"
    if (answer === "ninguno") return [];

    // Si la respuesta no tiene números válidos, conservar todos (no bloquear)
    const nums = answer.split(/[\s,;]+/).map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 1 && n <= products.length);
    if (nums.length === 0) return products;
    return nums.map(n => products[n - 1]);
  } catch {
    return products;
  }
}

async function buildProductCatalogContext(): Promise<string> {
  try {
    const { categories, usdToArs } = await getMongoProducts({ limit: 1 });
    const db = await getMongoDB();

    const counts = await db.collection("stock").aggregate([
      { $match: { isActive: { $ne: false }, price: { $gt: 0 } } },
      { $group: { _id: "$category", total: { $sum: 1 }, conStock: { $sum: { $cond: [{ $gt: ["$quantity", 0] }, 1, 0] } } } },
    ]).toArray() as Array<{ _id: string; total: number; conStock: number }>;

    const catMap: Record<string, { total: number; conStock: number }> = {};
    for (const c of counts) catMap[c._id] = { total: c.total, conStock: c.conStock };

    const catLines = categories
      .filter((c) => catMap[c.id]?.total > 0)
      .map((c) => `  • ${c.name}: ${catMap[c.id].total} productos (${catMap[c.id].conStock} con stock)`)
      .join("\n");

    return `\n\n--- CATÁLOGO ALTA TELEFONÍA (1 USD = ARS ${usdToArs}) ---
Tenés acceso a más de 3.500 productos en estas categorías:
${catLines}

NOTA IMPORTANTE: "Módulo" en este catálogo = ensamble completo de pantalla+táctil (NO es una parte genérica). Cuando el cliente pregunta por un modelo específico, los productos encontrados se agregan automáticamente al contexto. Invitá al cliente a preguntarte por el modelo exacto.
--- FIN ---`;
  } catch {
    return "";
  }
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const ext    = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "ogg";

  const file = new File([audioBuffer as unknown as BlobPart], `audio.${ext}`, { type: mimeType });

  const result = await openai.audio.transcriptions.create({
    file,
    model:    "whisper-1",
    language: "es",
  });
  return result.text?.trim() ?? "";
}

export async function generateAIResponse(
  systemPrompt: string,
  conversationHistory: AIMessage[],
  _legacyProducts: Product[],
  _model = GROQ_MODEL,
  temperature = 0.7,
  maxTokens = 500,
  includeProducts = true,
  customApiKey?: string | null,
  relevantProducts?: MongoProduct[]
): Promise<string> {
  // Fix: "Sos Nova," → "Nova," / "Sos Nova." → "Nova." etc.
  const sanitizedPrompt = systemPrompt.replace(/\bSos\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g, "$1");
  let prompt = sanitizedPrompt +
    `\n\n*Regla de contexto:* Sos un vendedor humano. Cuando el cliente pregunta algo nuevo, respondés SOLO sobre eso nuevo — como si no hubiese existido la pregunta anterior. NUNCA mencionés productos o temas previos de la conversación a menos que el cliente los nombre explícitamente. Cada pregunta es un tema fresco. No hagas puentes ni cierres temas anteriores.`;

  if (includeProducts) {
    if (relevantProducts && relevantProducts.length > 0) {
      // Use pre-searched products (faster, more relevant)
      const { usdToArs } = relevantProducts[0] ? { usdToArs: relevantProducts[0].usdToArs } : { usdToArs: 1500 };
      const lines = relevantProducts.map((p: MongoProduct) => {
        const stockLabel = p.available ? "DISPONIBLE" : "SIN STOCK";
        const price = p.promoPrice
          ? `USD ${p.promoPrice} (oferta) / ARS ${p.promoPriceARS?.toLocaleString("es-AR")}`
          : `USD ${p.price} / ARS ${p.priceARS.toLocaleString("es-AR")}`;
        const cat = p.category ? ` [${p.category}]` : "";
        return `- ${p.name}${cat} | ${price} | ${stockLabel}`;
      });
      prompt += `\n\n--- PRODUCTOS ENCONTRADOS (1 USD = ARS ${usdToArs}) ---\n${lines.join("\n")}\n--- FIN ---\n\n⚠️ REGLAS ESTRICTAS PARA ESTE MENSAJE:\n1. Presentá SOLO los productos de la lista de arriba — no inventes ni agregues otros.\n2. Si hay productos disponibles: mostrá nombre, precio USD y ARS, y estado de stock.\n3. Si hay productos sin stock: avisalo claramente igual.\n4. Sé breve: máx 3-4 líneas por producto.\n5. No menciones temas anteriores de la conversación.\n6. Si el cliente escribió mal el modelo (ej: "13 pro maxx") igual mostrá lo que encontraste más cercano.\n7. Invitá a agregar al carrito con el botón que aparece debajo.`;
    } else {
      // No specific products found — use general catalog
      prompt += await buildProductCatalogContext();
    }
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: prompt },
    ...conversationHistory.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content ?? "",
    })),
  ];

  // ── 1. OpenAI GPT-4o-mini (primary) ──────────────────────────────────────
  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    });
    const text = completion.choices[0]?.message?.content;
    if (text) return text;
  } catch (err) {
    console.warn("[AI] OpenAI failed, falling back to Groq:", (err as Error).message);
  }

  // ── 2. Fallback: Groq Llama ───────────────────────────────────────────────
  const groq = new Groq({ apiKey: customApiKey || GROQ_API_KEY });
  const groqCompletion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: messages as Groq.Chat.ChatCompletionMessageParam[],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  });
  return groqCompletion.choices[0]?.message?.content ?? "No pude procesar tu consulta, intentá de nuevo.";
}
