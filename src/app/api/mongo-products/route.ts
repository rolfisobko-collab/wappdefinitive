import { NextResponse } from "next/server";
import { getMongoProducts } from "@/lib/mongodb";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search     = searchParams.get("search")     ?? "";
    const categoryId = searchParams.get("categoryId") ?? "";
    const available  = searchParams.get("available")  === "true";

    const data = await getMongoProducts({
      search:      search     || undefined,
      categoryId:  categoryId || undefined,
      onlyAvailable: available || undefined,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[mongo-products GET]", error);
    return NextResponse.json({ error: "Error al obtener productos" }, { status: 500 });
  }
}
