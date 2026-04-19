import { NextResponse } from "next/server";
import { getAIConfig, saveAIConfig } from "@/lib/db";

export async function GET() {
  try {
    const config = await getAIConfig();
    const c = config as Record<string, unknown>;
    return NextResponse.json({
      ...c,
      groqApiKey: c.groqApiKey ? "***configured***" : null,
      hasGroqKey: true, // hardcoded en ai.ts
    });
  } catch (error) {
    console.error("[GET /api/ai-config]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.name             !== undefined) data.name             = body.name;
    if (body.systemPrompt     !== undefined) data.systemPrompt     = body.systemPrompt;
    if (body.temperature      !== undefined) data.temperature      = parseFloat(body.temperature);
    if (body.maxTokens        !== undefined) data.maxTokens        = parseInt(body.maxTokens);
    if (typeof body.includeProducts === "boolean") data.includeProducts = body.includeProducts;
    if (body.groqApiKey && body.groqApiKey !== "***configured***") data.groqApiKey = body.groqApiKey;

    const config = await saveAIConfig(data);
    const c = config as Record<string, unknown>;
    return NextResponse.json({
      ...c,
      groqApiKey: c.groqApiKey ? "***configured***" : null,
      hasGroqKey: true,
    });
  } catch (error) {
    console.error("[PUT /api/ai-config]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
