import { MongoClient, Db } from "mongodb";

const _uri = "mongodb+srv://leandrosobko_db_user:39kokOttcCd8gZn1@cluster0.qkjc22r.mongodb.net/test?retryWrites=true&w=majority";
const DB_NAME = "test";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getMongoDB(): Promise<Db> {
  if (cachedDb) return cachedDb;
  const client = new MongoClient(_uri);
  await client.connect();
  cachedClient = client;
  cachedDb = client.db(DB_NAME);
  // Ensure text index for search (idempotent)
  cachedDb.collection("stock").createIndex({ name: "text", description: "text" }).catch(() => {});
  return cachedDb;
}

// ─── Synonyms ───────────────────────────────────────────────────────────────

// Strip accents for lookup key
function stripAccents(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Build accent-insensitive regex pattern: "modulo" → "m[oó]d[uú]l[oó]"
function accentRegex(term: string): string {
  return stripAccents(term)
    .replace(/[aá]/gi, "[aáAÁ]")
    .replace(/[eé]/gi, "[eéEÉ]")
    .replace(/[ií]/gi, "[iíIÍ]")
    .replace(/[oó]/gi, "[oóOÓ]")
    .replace(/[uúü]/gi, "[uúüUÚÜ]")
    .replace(/[nñ]/gi, "[nñNÑ]");
}

// IMPORTANTE: "módulo" en esta BD = ensamble pantalla+táctil completo (NO es sinónimo genérico)
// Cada término apunta a sus propios sinónimos SIN cruzar con módulo
const SYNONYMS: Record<string, string[]> = {
  // Baterías
  bateria:     ["battery", "pila"],
  battery:     ["bateria", "pila"],
  // Placas
  placa:       ["board", "motherboard", "madre", "pcb"],
  board:       ["placa", "motherboard", "madre"],
  // Cámaras
  camara:      ["camera", "lente", "sensor"],
  camera:      ["camara", "lente", "sensor"],
  // Flex / FPC
  flex:        ["fpc", "ribbon"],
  fpc:         ["flex", "ribbon"],
  // Cargadores / conectores
  cargador:    ["charger", "pin carga", "dock"],
  charger:     ["cargador", "pin carga"],
  conector:    ["puerto", "pin", "dock", "jack"],
  // Audio
  auricular:   ["earpiece", "parlante", "altavoz", "bocina"],
  parlante:    ["auricular", "earpiece", "bocina"],
  bocina:      ["parlante", "auricular", "earpiece"],
  // Touch / táctil (distinto de módulo)
  tactil:      ["touch", "vidrio"],
  touch:       ["tactil", "vidrio"],
  // Micrófonos
  microfono:   ["mic"],
  // Tapas / carcasas
  tapa:        ["back cover", "contratapa", "carcasa"],
  carcasa:     ["tapa", "cover", "marco"],
  // Botones
  encendido:   ["power"],
  volumen:     ["volume"],
  // Vibrador
  vibrador:    ["vibration", "motor vibracion"],
  // Display / pantalla (SIN módulo — son distintos en esta BD)
  display:     ["pantalla", "lcd"],
  pantalla:    ["display", "lcd"],
  lcd:         ["pantalla", "display"],
};

export function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set<string>();
  for (const kw of keywords) {
    const norm = stripAccents(kw);
    expanded.add(norm);
    for (const s of SYNONYMS[norm] ?? []) expanded.add(stripAccents(s));
  }
  return Array.from(expanded);
}

// Build OR regex filter using accent-insensitive patterns
export function buildSearchFilter(keywords: string[]): Record<string, unknown> {
  const patterns = keywords.map((k) => ({
    name: { $regex: accentRegex(k), $options: "i" },
  }));
  return { $or: patterns };
}

// ─── Order creation ──────────────────────────────────────────────────────────

export interface WAOrder {
  mongoProductId: string;
  name: string;
  image: string | null;
  unitPriceUSD: number;
  quantity: number;
}

export async function createOrderInMongo(data: {
  contactName: string;
  phone: string;
  items: WAOrder[];
  totalUSD: number;
  notes?: string;
}): Promise<string> {
  const db = await getMongoDB();
  const result = await db.collection("orders").insertOne({
    customer:      data.contactName,
    phone:         data.phone,
    email:         "",
    source:        "whatsapp",
    status:        "pending",
    items:         data.items.map((i) => ({
      productId: i.mongoProductId,
      name:      i.name,
      price:     i.unitPriceUSD,
      quantity:  i.quantity,
      image:     i.image,
    })),
    subtotal:      data.totalUSD,
    shipping:      0,
    total:         data.totalUSD,
    paymentMethod: "pending",
    paymentStatus: "pending",
    shippingAddress: {
      street: "", city: "", state: "", zipCode: "", country: "Argentina",
    },
    notes:         data.notes ?? "Pedido via WhatsApp",
    createdAt:     new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
    __v:           0,
    statusHistory: [],
  });
  return result.insertedId.toString();
}

export interface MongoProduct {
  id: string;
  name: string;
  price: number;
  priceARS: number;
  promoPrice: number | null;
  promoPriceARS: number | null;
  currency: "USD";
  usdToArs: number;
  image: string | null;
  images: string[];
  stock: number;
  available: boolean;
  category: string | null;
  categoryId: string | null;
  sku: number | null;
  description: string;
  location: string | null;
  weeklyOffer: boolean;
  liquidation: boolean;
}

export async function getMongoProductById(id: string): Promise<MongoProduct | null> {
  const db = await getMongoDB();
  const rateDoc = await db.collection("exchangeRates").findOne({ _id: "USD_ARS" } as object);
  const usdToArs: number = (rateDoc as Record<string, unknown> | null)?.rate as number ?? 1500;
  const catDocs = await db.collection("stockCategories").find({}).toArray();
  const catMap: Record<string, string> = {};
  for (const c of catDocs) catMap[c._id as string] = c.name as string;

  const p = await db.collection("stock").findOne({ _id: id } as object);
  if (!p) return null;
  const price = (p.price as number) ?? 0;
  const promoPrice = (p.promoPrice as number | null) ?? null;
  return {
    id: p._id as string,
    name: p.name as string,
    price, priceARS: Math.round(price * usdToArs),
    promoPrice, promoPriceARS: promoPrice ? Math.round(promoPrice * usdToArs) : null,
    currency: "USD", usdToArs,
    image: ((p.images as string[] | undefined)?.[0]) || (p.image1 as string | null) || null,
    images: ((p.images as string[] | undefined) ?? []).filter(Boolean),
    stock: (p.quantity as number) ?? 0,
    available: ((p.quantity as number) ?? 0) > 0,
    category: catMap[p.category as string] ?? null,
    categoryId: (p.category as string) ?? null,
    sku: (p.sku as number) ?? null,
    description: ((p.description as string) || "").slice(0, 300),
    location: (p.location as string) ?? null,
    weeklyOffer: (p.weeklyOffer as boolean) ?? false,
    liquidation: (p.liquidation as boolean) ?? false,
  };
}

export async function getMongoProducts(opts: {
  search?: string;
  keywords?: string[];
  categoryId?: string;
  limit?: number;
  onlyAvailable?: boolean;
} = {}): Promise<{ products: MongoProduct[]; categories: { id: string; name: string; icon?: string }[]; usdToArs: number }> {
  const db = await getMongoDB();

  // Exchange rate
  const rateDoc = await db.collection("exchangeRates").findOne({ _id: "USD_ARS" } as object);
  const usdToArs: number = (rateDoc as Record<string, unknown> | null)?.rate as number ?? 1500;

  // Categories map
  const catDocs = await db.collection("stockCategories").find({}).toArray();
  const catMap: Record<string, string> = {};
  for (const c of catDocs) catMap[c._id as string] = c.name as string;
  const categories = catDocs.map((c) => ({
    id: c._id as string,
    name: c.name as string,
    icon: c.icon as string | undefined,
  })).sort((a, b) => a.name.localeCompare(b.name));

  // Base filter
  const baseFilter: Record<string, unknown> = {
    isActive: { $ne: false },
    price:    { $gt: 0 },
  };
  if (opts.categoryId)  baseFilter.category = opts.categoryId;
  if (opts.onlyAvailable) baseFilter.quantity = { $gt: 0 };

  let raw;

  if (opts.keywords?.length || opts.search) {
    // Expand keywords with synonyms
    const rawKeywords = opts.keywords ?? (opts.search ? [opts.search] : []);
    const expanded    = expandKeywords(rawKeywords);

    // Try text index first (best relevance)
    try {
      const textSearch = expanded.join(" ");
      const textFilter = { ...baseFilter, $text: { $search: textSearch } };
      raw = await db.collection("stock")
        .find(textFilter, { projection: { score: { $meta: "textScore" } } })
        .sort({ score: { $meta: "textScore" } })
        .limit(opts.limit ?? 10)
        .toArray();
    } catch {
      raw = [];
    }

    // Fallback: accent-insensitive OR regex if text search returned < 2
    if (raw.length < 2) {
      const orFilter = { ...baseFilter, ...buildSearchFilter(expanded) };
      raw = await db.collection("stock").find(orFilter).limit(opts.limit ?? 10).toArray();
    }
  } else {
    raw = await db.collection("stock").find(baseFilter).limit(opts.limit ?? 300).toArray();
  }

  const products: MongoProduct[] = raw.map((p) => {
    const price = (p.price as number) ?? 0;
    const promoPrice = (p.promoPrice as number | null) ?? null;
    return {
      id: p._id as string,
      name: p.name as string,
      price,
      priceARS: Math.round(price * usdToArs),
      promoPrice,
      promoPriceARS: promoPrice ? Math.round(promoPrice * usdToArs) : null,
      currency: "USD",
      usdToArs,
      image: ((p.images as string[] | undefined)?.[0]) || (p.image1 as string | null) || null,
      images: ((p.images as string[] | undefined) ?? []).filter(Boolean),
      stock: (p.quantity as number) ?? 0,
      available: ((p.quantity as number) ?? 0) > 0,
      category: catMap[p.category as string] ?? null,
      categoryId: (p.category as string) ?? null,
      sku: (p.sku as number) ?? null,
      description: ((p.description as string) || (p.markdownDescription as string) || "").slice(0, 300),
      location: (p.location as string) ?? null,
      weeklyOffer: (p.weeklyOffer as boolean) ?? false,
      liquidation: (p.liquidation as boolean) ?? false,
    };
  });

  return { products, categories, usdToArs };
}
