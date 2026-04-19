import { NextResponse } from "next/server";
import { getProducts, createProduct } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const products = await getProducts(searchParams.get("active") === "true");
    return NextResponse.json(products);
  } catch (error) {
    console.error("[GET /api/products]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name || body.price === undefined) {
      return NextResponse.json({ error: "name y price requeridos" }, { status: 400 });
    }
    const product = await createProduct({
      name: body.name,
      description: body.description ?? null,
      price: parseFloat(body.price),
      currency: body.currency ?? "ARS",
      imageUrl: body.imageUrl ?? null,
      category: body.category ?? null,
      sku: body.sku ?? null,
      stock: parseInt(body.stock ?? 0),
    });
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error("[POST /api/products]", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
