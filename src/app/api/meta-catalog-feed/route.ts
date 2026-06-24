import { getMongoProducts, type MongoProduct } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://wappdefinitive-production.up.railway.app";

function csv(value: unknown): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function humanizeCatalogText(value: unknown): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const letters = text.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  const upperLetters = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
  if (!letters || upperLetters / letters.length < 0.75) return text;

  return text.toLocaleLowerCase("es-AR").replace(
    /(^|[\s/+\-])([a-záéíóúüñ])/g,
    (match, prefix: string, char: string) => `${prefix}${char.toLocaleUpperCase("es-AR")}`
  ).replace(/\bIphone\b/g, "iPhone")
    .replace(/\bIpad\b/g, "iPad")
    .replace(/\bMacbook\b/g, "MacBook")
    .replace(/\bOca\b/g, "OCA")
    .replace(/\bTpu\b/g, "TPU")
    .replace(/\bLcd\b/g, "LCD")
    .replace(/\bUsb\b/g, "USB")
    .replace(/\bTipo-C\b/g, "Tipo-C");
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
  if (image && /^https?:\/\//i.test(image) && /res\.cloudinary\.com\/.+\/image\/upload\//i.test(image)) {
    return image
      .replace(/\/image\/upload\//i, "/image/upload/f_png,q_auto,w_1200,h_1200,c_pad,b_white/")
      .replace(/\.(webp|jpe?g)([?#].*)?$/i, ".png$2");
  }
  return `${baseUrl}/api/catalog-placeholder.png`;
}

function retailerId(product: MongoProduct): string {
  const raw = product.sku ? `sku_${product.sku}` : `id_${product.id}`;
  return raw.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100);
}

function productDescription(product: MongoProduct): string {
  return [
    humanizeCatalogText(product.description),
    product.category ? `Categoria: ${humanizeCatalogText(product.category)}` : null,
    product.deviceBrand || product.deviceModel
      ? `Equipo: ${[product.deviceBrand, product.deviceModel].filter(Boolean).map(humanizeCatalogText).join(" ")}`
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
    humanizeCatalogText(product.name).slice(0, 150),
    productDescription(product) || product.name,
    product.stock > 0 ? "in stock" : "out of stock",
    "new",
    `${Math.max(1, Math.round(product.promoPriceARS ?? product.priceARS))} ARS`,
    productUrl(product, baseUrl),
    imageUrl(product, baseUrl),
    humanizeCatalogText(product.deviceBrand || product.partBrand || "Alta Telefonia"),
    humanizeCatalogText(product.category || "Repuestos"),
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
