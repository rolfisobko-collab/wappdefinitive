import { getMongoProducts, type MongoProduct } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://wappdefinitive-production.up.railway.app";

function csv(value: unknown): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function absoluteBaseUrl(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured?.startsWith("http")) return configured.replace(/\/$/, "");
  try {
    const origin = new URL(req.url).origin;
    return /localhost|127\.0\.0\.1/i.test(origin) ? DEFAULT_BASE_URL : origin;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function imageUrl(product: MongoProduct, baseUrl: string): string {
  const image = product.image || product.images?.find(Boolean);
  if (image && /^https?:\/\//i.test(image)) return image;
  return `${baseUrl}/catalog-placeholder.svg`;
}

function retailerId(product: MongoProduct): string {
  const raw = product.sku ? `sku_${product.sku}` : `id_${product.id}`;
  return raw.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100);
}

function productDescription(product: MongoProduct): string {
  return [
    product.description,
    product.category ? `Categoria: ${product.category}` : null,
    product.deviceBrand || product.deviceModel
      ? `Equipo: ${[product.deviceBrand, product.deviceModel].filter(Boolean).join(" ")}`
      : null,
    product.sku ? `SKU: ${product.sku}` : null,
  ].filter(Boolean).join(" | ").slice(0, 999);
}

function productUrl(product: MongoProduct, baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("sku", String(product.sku ?? product.id));
  return url.toString();
}

export async function GET(req: Request) {
  const baseUrl = absoluteBaseUrl(req);
  const { products } = await getMongoProducts({ limit: 10000, onlyAvailable: false });
  const headers = [
    "id",
    "title",
    "description",
    "availability",
    "condition",
    "price",
    "link",
    "image_link",
    "brand",
    "product_type",
    "custom_label_0",
    "custom_label_1",
  ];

  const rows = products.map((product) => [
    retailerId(product),
    product.name,
    productDescription(product) || product.name,
    product.stock > 0 ? "in stock" : "out of stock",
    "new",
    `${Math.max(1, Math.round(product.promoPriceARS ?? product.priceARS))} ARS`,
    productUrl(product, baseUrl),
    imageUrl(product, baseUrl),
    product.deviceBrand || product.partBrand || "Alta Telefonia",
    product.category || "Repuestos",
    product.sku ? `SKU ${product.sku}` : "",
    product.stock > 0 ? "Disponible" : "Sin stock",
  ].map(csv).join(","));

  const body = [headers.join(","), ...rows].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="alta-whatsapp-catalog.csv"',
      "Cache-Control": "public, max-age=900, s-maxage=900",
    },
  });
}
