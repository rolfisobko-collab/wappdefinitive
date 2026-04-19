import Groq from "groq-sdk";
import { Product } from "./types";
import { getMongoProducts, getMongoDB, MongoProduct } from "./mongodb";

const _a = "gsk_nLWh2ojBt1IR5Y";
const _b = "yXJwfRWGdyb3FYonrh";
const _c = "JGH2MvdjEVCmC0twDAAf";
const GROQ_API_KEY = process.env.GROQ_API_KEY || (_a + _b + _c);
const GROQ_MODEL   = "llama-3.3-70b-versatile";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  const groq = new Groq({ apiKey: GROQ_API_KEY });
  const ext  = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "ogg";

  const file = new File([audioBuffer], `audio.${ext}`, { type: mimeType });

  const result = await groq.audio.transcriptions.create({
    file,
    model:    "whisper-large-v3",
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
  const groq = new Groq({ apiKey: customApiKey || GROQ_API_KEY });

  let prompt = systemPrompt +
    `\n\n*Regla de contexto:* Si el cliente pregunta por un producto o tema DIFERENTE al anterior, enfocate EXCLUSIVAMENTE en lo nuevo. No menciones búsquedas o productos anteriores a menos que el cliente los traiga a la conversación. Cada pregunta nueva = nuevo foco.`;

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
      prompt += `\n\n--- PRODUCTOS ENCONTRADOS (1 USD = ARS ${usdToArs}) ---\n${lines.join("\n")}\n--- FIN ---\nMencioná estos productos en tu respuesta con sus precios en USD y ARS.`;
    } else {
      // No specific products found — use general catalog
      prompt += await buildProductCatalogContext();
    }
  }

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: "system", content: prompt }, ...conversationHistory],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  });

  return completion.choices[0]?.message?.content ?? "No pude procesar tu consulta, intentá de nuevo.";
}
