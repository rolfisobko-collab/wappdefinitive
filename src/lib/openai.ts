/**
 * ─────────────────────────────────────────────────────────────────
 * DESHABILITADO — Integración OpenAI (GPT-4, GPT-3.5, etc.)
 * ─────────────────────────────────────────────────────────────────
 * Se migró a Groq (src/lib/ai.ts) por costo: Groq es gratuito
 * y significativamente más barato que OpenAI a escala.
 *
 * Para reactivar OpenAI:
 *   1. npm install openai
 *   2. Agregar OPENAI_API_KEY en .env
 *   3. Cambiar los imports en:
 *      - src/app/api/webhook/route.ts
 *      - src/app/api/conversations/[id]/messages/route.ts
 *      de "@/lib/ai" a "@/lib/openai"
 * ─────────────────────────────────────────────────────────────────
 */

/*
import OpenAI from "openai";
import { Product } from "./types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateAIResponse(
  systemPrompt: string,
  conversationHistory: AIMessage[],
  products: Product[],
  model: string = "gpt-4o-mini",
  temperature: number = 0.7,
  maxTokens: number = 500,
  includeProducts: boolean = true
): Promise<string> {
  let finalSystemPrompt = systemPrompt;

  if (includeProducts && products.length > 0) {
    const productList = products
      .filter((p) => p.active)
      .map(
        (p) =>
          `- ${p.name} | Precio: $${p.price} ${p.currency}${p.description ? ` | ${p.description}` : ""}${p.stock > 0 ? ` | Stock: ${p.stock}` : " | SIN STOCK"}`
      )
      .join("\n");

    finalSystemPrompt += `\n\n--- CATÁLOGO DE PRODUCTOS DISPONIBLES ---\n${productList}\n--- FIN DEL CATÁLOGO ---`;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: finalSystemPrompt },
    ...conversationHistory,
  ];

  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  return completion.choices[0]?.message?.content ?? "Lo siento, no pude procesar tu consulta.";
}

export { openai };
*/
