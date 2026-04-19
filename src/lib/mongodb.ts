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
  return cachedDb;
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

  // Build filter
  const filter: Record<string, unknown> = {
    isActive: { $ne: false },
    price: { $gt: 0 },
  };

  // Keyword OR search (most specific)
  if (opts.keywords?.length) {
    filter.$or = opts.keywords.map((k) => ({ name: { $regex: k, $options: "i" } }));
  } else if (opts.search) {
    filter.name = { $regex: opts.search, $options: "i" };
  }

  if (opts.categoryId) filter.category = opts.categoryId;
  if (opts.onlyAvailable) filter.quantity = { $gt: 0 };

  const raw = await db.collection("stock").find(filter).limit(opts.limit ?? 300).toArray();

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
