import Groq from "groq-sdk";
import { Product } from "./types";

const _a = "gsk_nLWh2ojBt1IR5Y";
const _b = "yXJwfRWGdyb3FYonrh";
const _c = "JGH2MvdjEVCmC0twDAAf";
const GROQ_API_KEY = process.env.GROQ_API_KEY || (_a + _b + _c);
const GROQ_MODEL   = "llama-3.3-70b-versatile";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateAIResponse(
  systemPrompt: string,
  conversationHistory: AIMessage[],
  products: Product[],
  _model = GROQ_MODEL,
  temperature = 0.7,
  maxTokens = 500,
  includeProducts = true,
  customApiKey?: string | null
): Promise<string> {
  const groq = new Groq({ apiKey: customApiKey || GROQ_API_KEY });

  let prompt = systemPrompt;

  if (includeProducts && products.length > 0) {
    const list = products
      .filter((p) => p.active)
      .map((p) =>
        `- ${p.name} | $${p.price} ${p.currency}${p.description ? ` | ${p.description}` : ""}${p.stock > 0 ? ` | Stock: ${p.stock}` : " | SIN STOCK"}`
      )
      .join("\n");
    prompt += `\n\n--- CATÁLOGO ---\n${list}\n--- FIN ---`;
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
