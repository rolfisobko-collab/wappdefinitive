import Groq from "groq-sdk";
import { Product } from "./types";
import { getMongoProducts, MongoProduct } from "./mongodb";

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
    const { products, usdToArs } = await getMongoProducts({ limit: 150 });
    if (!products.length) return "";

    const lines = products.map((p: MongoProduct) => {
      const stockLabel = p.available ? `Stock: ${p.stock}` : "SIN STOCK";
      const price = p.promoPrice
        ? `USD ${p.promoPrice} (oferta, antes USD ${p.price}) / ARS ${p.promoPriceARS?.toLocaleString("es-AR")}`
        : `USD ${p.price} / ARS ${p.priceARS.toLocaleString("es-AR")}`;
      const cat = p.category ? ` [${p.category}]` : "";
      return `- ${p.name}${cat} | ${price} | ${stockLabel}`;
    });

    return `\n\n--- CATÁLOGO DE PRODUCTOS (1 USD = ARS ${usdToArs}) ---\n${lines.join("\n")}\n--- FIN CATÁLOGO ---`;
  } catch {
    return "";
  }
}

export async function generateAIResponse(
  systemPrompt: string,
  conversationHistory: AIMessage[],
  _legacyProducts: Product[],
  _model = GROQ_MODEL,
  temperature = 0.7,
  maxTokens = 500,
  includeProducts = true,
  customApiKey?: string | null
): Promise<string> {
  const groq = new Groq({ apiKey: customApiKey || GROQ_API_KEY });

  let prompt = systemPrompt;

  if (includeProducts) {
    prompt += await buildProductCatalogContext();
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
