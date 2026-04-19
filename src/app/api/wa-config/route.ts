import { NextResponse } from "next/server";
import { getWAConfig, saveWAConfig } from "@/lib/db";

export async function GET() {
  try {
    const config = await getWAConfig();
    if (!config) return NextResponse.json(null);
    const c = config as Record<string, unknown>;
    return NextResponse.json({ id: "wa", phoneNumberId: c.phoneNumberId, businessId: c.businessId, verifyToken: c.verifyToken });
  } catch (error) {
    console.error("[GET /api/wa-config]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await saveWAConfig(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PUT /api/wa-config]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
