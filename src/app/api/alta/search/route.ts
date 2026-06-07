import { NextResponse } from "next/server";
import { searchAltaProducts } from "@/lib/altaSearch";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? searchParams.get("message") ?? "";
  const limit = parseInt(searchParams.get("limit") ?? "5000", 10);

  if (!q.trim()) {
    return NextResponse.json({ error: "q requerido" }, { status: 400 });
  }

  try {
    return NextResponse.json(await searchAltaProducts(q, limit));
  } catch (error) {
    console.error("[GET /api/alta/search]", error);
    return NextResponse.json({ error: "Error buscando productos Alta" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = String(body.message ?? body.q ?? "").trim();
    const limit = parseInt(String(body.limit ?? "5000"), 10);

    if (!message) {
      return NextResponse.json({ error: "message requerido" }, { status: 400 });
    }

    return NextResponse.json(await searchAltaProducts(message, limit));
  } catch (error) {
    console.error("[POST /api/alta/search]", error);
    return NextResponse.json({ error: "Error buscando productos Alta" }, { status: 500 });
  }
}
