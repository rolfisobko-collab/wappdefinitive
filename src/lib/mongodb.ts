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

const SYNONYMS: Record<string, string[]> = {
  pantalla:    ["display", "lcd", "tactil", "tela", "vidrio", "screen"],
  display:     ["pantalla", "lcd", "tactil", "tela", "screen"],
  lcd:         ["pantalla", "display", "tactil"],
  bateria:     ["battery", "pila", "batería"],
  battery:     ["bateria", "pila", "batería"],
  placa:       ["board", "motherboard", "madre", "pcb"],
  board:       ["placa", "motherboard", "madre"],
  camara:      ["camera", "lente", "sensor", "foto"],
  camera:      ["camara", "lente", "sensor"],
  flex:        ["fpc", "ribbon", "cable flex"],
  fpc:         ["flex", "ribbon"],
  cargador:    ["charger", "pin carga", "usb", "dock"],
  charger:     ["cargador", "pin carga"],
  auricular:   ["earpiece", "parlante", "altavoz", "bocina"],
  parlante:    ["auricular", "earpiece", "bocina", "altavoz"],
  tactil:      ["touch", "pantalla", "vidrio"],
  touch:       ["tactil", "pantalla", "vidrio"],
  microfono:   ["mic", "micrófono"],
  tapa:        ["back cover", "back glass", "contratapa", "carcasa"],
  carcasa:     ["tapa", "cover", "marco"],
  encendido:   ["power", "boton power", "botón encendido"],
  volumen:     ["volume", "boton volumen"],
  conector:    ["puerto", "pin", "dock", "jack"],
  vibrador:    ["vibration", "motor vibracion"],
};

export function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    const normalized = kw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const syns = SYNONYMS[normalized] ?? [];
    for (const s of syns) expanded.add(s);
  }
  return Array.from(expanded);
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

    // Fallback: OR regex on all expanded terms if text search returned < 2
    if (raw.length < 2) {
      const orFilter = {
        ...baseFilter,
        $or: expanded.map((k) => ({ name: { $regex: k, $options: "i" } })),
      };
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
