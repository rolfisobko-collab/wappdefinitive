import { getMongoProducts, MongoProduct } from "./mongodb";

type ProductClass = {
  raw: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  quality: string | null;
  sku: string | null;
  tokens: string[];
  confidence: number;
  detected: string[];
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  "PLACA DE CARGA": [
    "placa de carga", "placa carga", "placa pin", "pcb carga",
    "conector de carga", "conector carga", "puerto carga", "puerto usb",
    "pin de carga", "pin carga", "dock", "conector usb", "usb carga",
  ],
  "PIN DE CARGA": ["pin de carga", "pin carga"],
  "MODULO": [
    "modulo", "pantalla completa", "display completo", "lcd con tactil",
    "pantalla con tactil", "display con touch", "pantalla ensamblada",
    "combo pantalla", "pantalla", "display", "lcd", "screen", "touch lcd",
  ],
  "GLASS": ["glass", "solo glass", "solo tactil", "solo vidrio", "tactil", "touch screen", "digitizer", "vidrio", "cristal"],
  "BATERIA": ["bateria", "battery", "pila", "acumulador", "baterias", "carga bateria", "bateri"],
  "TAPAS": ["tapa trasera", "tapa posterior", "tapa de atras", "back glass", "back cover", "tapa vidrio", "contratapa", "tapa"],
  "LENTES DE CAMARA": ["lente camara", "lentes camara", "lente de camara", "vidrio camara", "cristal camara", "cover camara", "visor camara"],
  "CAMARA FRONTAL": ["camara frontal", "cam frontal", "front camera", "selfie cam", "camara delantera", "frontal"],
  "CAMARA PRINCIPAL": ["camara principal", "camara trasera", "camara de atras", "rear camera", "main camera", "back camera", "camara"],
  "FLEX DE ENCENDIDO": ["flex encendido", "flex de encendido", "flex power", "power flex", "boton encendido", "flex on off", "flex on/off"],
  "FLEX": ["flex volumen", "flex de volumen", "flex botones", "flex lateral", "ribbon", "flex cable", "flex"],
  "AURICULAR": ["auricular", "earpiece", "bocina auricular", "parlante auricular"],
  "CAMPANILLA": ["campanilla", "buzzer", "parlante externo", "altavoz", "speaker"],
  "CARCAZA": ["carcaza", "carcasa", "marco lateral", "frame", "chasis", "housing", "marco"],
  "CARGADORES": ["cargador", "charger", "adaptador carga", "cabezal"],
  "CABLES": ["cable usb", "cable carga", "cable datos"],
  "MICROFONOS": ["microfono", "mic "],
  "BOTONES": ["boton lateral", "boton volumen"],
  "COMPONENTES": ["ic ", "chip ", "componente smd", "transistor", "condensador"],
};

const BRAND_ALIASES: Record<string, string[]> = {
  "IPHONE": ["iphone", "iph ", "ip ", "apple"],
  "SAMSUNG": ["samsung", "galaxy", "sam "],
  "MOTOROLA": ["motorola", "moto g", "moto e", "moto s"],
  "XIAOMI": ["xiaomi", "redmi", "poco"],
  "NOKIA": ["nokia"],
  "TCL": ["tcl"],
  "HUAWEI": ["huawei"],
  "HONOR": ["honor"],
  "ALCATEL": ["alcatel"],
  "LG": [" lg "],
  "OPPO": ["oppo"],
  "VIVO": ["vivo"],
  "REALME": ["realme"],
  "ZTE": ["zte", "blade"],
  "ASUS": ["asus", "zenfone"],
};

const BRANDS = Object.keys(BRAND_ALIASES);

const QUALITY_ALIASES: Record<string, string[]> = {
  "ORIGINAL": ["original", "genuino", "oem"],
  "COMPATIBLE": ["compatible", "generico", "copia"],
  "SOFT OLED": ["soft oled"],
  "HARD OLED": ["hard oled"],
  "AMOLED": ["amoled"],
  "OLED": ["oled"],
  "FHD": ["fhd"],
  "HD": [" hd "],
  "FASTCHARGE": ["fastcharge", "fast charge", "carga rapida"],
  "EXTRADURACION": ["extraduracion", "extra duracion"],
  "SUNLONG": ["sunlong"],
  "JK": [" jk "],
  "JCID": ["jcid"],
};

const IPHONE_MODELS = [
  "16 PRO MAX", "16 PRO", "16 PLUS", "16",
  "15 PRO MAX", "15 PRO", "15 PLUS", "15",
  "14 PRO MAX", "14 PRO", "14 PLUS", "14",
  "13 PRO MAX", "13 PRO", "13 MINI", "13",
  "12 PRO MAX", "12 PRO", "12 MINI", "12",
  "11 PRO MAX", "11 PRO", "11",
  "XS MAX", "XS", "XR", "X",
  "8 PLUS", "8G", "8",
  "7 PLUS", "7G", "7",
  "6S PLUS", "6S", "6 PLUS", "6G", "6",
  "SE 3", "SE 2", "SE",
];

const STOP_WORDS = new Set([
  "para", "que", "como", "con", "por", "una", "uno", "los", "las", "del",
  "esto", "esta", "tiene", "tenes", "cuanto", "hay", "quiero", "necesito",
  "busco", "hola", "buenas", "gracias", "quisiera", "podes", "tienen",
  "puedo", "ver", "lista", "catalogo", "dame", "manda", "mandame", "mas",
]);

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findAlias(cleanQuery: string, aliases: Record<string, string[]>): string | null {
  const padded = ` ${cleanQuery} `;
  for (const [key, values] of Object.entries(aliases)) {
    if (values.some((alias) => {
      const cleanAlias = norm(alias);
      return cleanAlias && padded.includes(cleanAlias);
    })) return key;
  }
  return null;
}

function extractSku(raw: string): string | null {
  const match = raw.match(/\b([A-Z]{2,5}\.?\d{4,6}|\d{3,8})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function extractBrand(cleanQuery: string): string | null {
  const padded = ` ${cleanQuery} `;
  const upper = padded.toUpperCase();
  for (const [brand, aliases] of Object.entries(BRAND_ALIASES)) {
    if (aliases.some((alias) => padded.includes(norm(alias)))) return brand;
  }
  for (const brand of BRANDS) {
    if (upper.includes(brand)) return brand;
  }
  return null;
}

function extractModel(cleanQuery: string, brand: string | null): string | null {
  if (brand === "IPHONE") {
    const upper = cleanQuery.toUpperCase();
    for (const model of IPHONE_MODELS) {
      const pattern = model.replace(/\s+/g, "\\s+");
      if (new RegExp(`\\b${pattern}\\b`).test(upper)) return model;
    }
    const match = cleanQuery.match(/\b(1[0-6]|[6-9])\b/);
    return match ? match[1].toUpperCase() : null;
  }

  if (brand === "SAMSUNG") {
    const note = cleanQuery.match(/\b(note\s*\d{1,2}(?:\s*ultra|\s*plus|\s*fe)?|tab\s*[a-z]?\s*\d{1,2}(?:\s*\+|\s*fe|\s*ultra|\s*s)?)\b/i);
    if (note) return note[1].replace(/\s+/g, " ").toUpperCase().trim();
    const match = cleanQuery.match(/\b([ASJMFCCB]\s*\d{2,3}\s*(?:5g|4g)?[a-z]?\s*(?:ultra|plus|fe|s|lite|pro|\+)?)\b/i);
    return match ? match[1].replace(/\s+/g, " ").toUpperCase().trim() : null;
  }

  if (brand === "MOTOROLA") {
    const match = cleanQuery.match(/\b(?:moto\s+)?([GES]\s*\d{1,3}\s*(?:play|plus|power|lite|pro|ultra|edge|stylus)?)\b/i);
    return match ? match[1].replace(/\s+/g, " ").toUpperCase().trim() : null;
  }

  if (brand === "XIAOMI") {
    const match = cleanQuery.match(/\b(redmi\s*(?:note\s*)?\d{1,2}[a-z]?(?:\s*pro|\s*plus)?|poco\s*[xmfc]\d{1,2}(?:\s*pro)?|mi\s*\d{1,2}(?:\s*pro)?|\d{1,2}[a-z]?\s*(?:pro|plus|ultra|c)?)\b/i);
    return match ? match[1].replace(/\s+/g, " ").toUpperCase().trim() : null;
  }

  const match = cleanQuery.match(/\b([a-z]\s*\d{1,3}\s*[a-z]?\s*(?:pro|plus|max|play|lite|ultra|note|edge|\+)?)\b/i);
  return match ? match[1].replace(/\s+/g, " ").toUpperCase().trim() : null;
}

export function classifyAltaQuery(query: string): ProductClass {
  const clean = norm(query);
  const brand = extractBrand(clean);
  const category = findAlias(clean, CATEGORY_ALIASES);
  const quality = findAlias(clean, QUALITY_ALIASES);
  const model = extractModel(clean, brand);
  const sku = extractSku(query);
  const tokens = clean
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token) && (/^\d+$/.test(token) || token.length > 2))
    .slice(0, 10);
  const detected = [category, brand, model, quality, sku].filter(Boolean) as string[];
  return {
    raw: query,
    category,
    brand,
    model,
    quality,
    sku,
    tokens,
    confidence: Math.min(detected.length / 3, 1),
    detected,
  };
}

function productText(product: MongoProduct): string {
  return norm([
    product.id,
    product.name,
    product.category,
    product.categoryId,
    product.sku,
    product.description,
    product.location,
  ].filter(Boolean).join(" "));
}

function hasModel(text: string, model: string | null): boolean {
  if (!model) return true;
  const cleanModel = norm(model).replace(/\s+/g, "\\s+");
  const suffixes = ["max", "plus", "ultra", "mini", "lite", "fe", "pro"];
  const modelParts = new Set(norm(model).split(/\s+/));
  const excluded = suffixes.filter((suffix) => !modelParts.has(suffix));
  const lookAhead = excluded.length ? `(?!\\s+(?:${excluded.join("|")})(?:\\s|$))` : "";
  return new RegExp(`(^|[\\s/(,])${cleanModel}${lookAhead}([\\s/),+]|$)`).test(text);
}

function detectProductQuality(product: MongoProduct): string {
  const text = productText(product);
  for (const quality of Object.keys(QUALITY_ALIASES)) {
    if (text.includes(norm(quality))) return quality;
  }
  return "GENERICA";
}

function filterProducts(products: MongoProduct[], cls: ProductClass): MongoProduct[] {
  let result = [...products];
  const strongClassification = [cls.category, cls.brand, cls.model, cls.quality, cls.sku]
    .filter(Boolean).length >= 2;

  if (cls.sku) {
    const exact = result.filter((product) =>
      String(product.sku ?? "").toUpperCase().includes(cls.sku ?? "") ||
      String(product.id ?? "").toUpperCase().includes(cls.sku ?? "")
    );
    if (exact.length) return exact.sort((a, b) => Number(b.stock) - Number(a.stock));
  }

  if (cls.category) {
    const cat = norm(cls.category);
    result = result.filter((product) => productText(product).includes(cat));
  }
  if (cls.brand) {
    const brand = norm(cls.brand);
    result = result.filter((product) => productText(product).includes(brand));
  }
  if (cls.model) {
    result = result.filter((product) => hasModel(productText(product), cls.model));
  }
  if (cls.quality) {
    const quality = norm(cls.quality);
    result = result.filter((product) => productText(product).includes(quality));
  }

  if (!result.length && cls.tokens.length && !strongClassification) {
    result = products.filter((product) => cls.tokens.every((token) => productText(product).includes(token)));
  }
  if (!result.length && cls.tokens.length && !strongClassification) {
    result = products.filter((product) => cls.tokens.some((token) => productText(product).includes(token)));
  }

  return result.sort((a, b) => Number(b.stock) - Number(a.stock));
}

function groupByQuality(products: MongoProduct[]) {
  const groups = new Map<string, MongoProduct[]>();
  for (const product of products) {
    const quality = detectProductQuality(product);
    const rows = groups.get(quality) ?? [];
    rows.push(product);
    groups.set(quality, rows);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quality, products]) => ({ quality, products }));
}

export async function searchAltaProducts(message: string, limit = 5000) {
  const cls = classifyAltaQuery(message);

  const broad = await getMongoProducts({ limit, onlyAvailable: false });
  const products = broad.products;
  const matches = filterProducts(products, cls);
  const available = matches.filter((product) => product.available);
  const visible = available.length ? available : matches;

  let mode = "empty";
  let responseMessage = "No encontre ese producto. Proba con repuesto + marca + modelo o SKU.";
  const groups = visible.length ? groupByQuality(visible) : [];
  const missing: string[] = [];

  if (matches.length && !available.length) {
    mode = "out_of_stock";
    responseMessage = "Encontre el producto, pero esta sin stock.";
  } else if (available.length === 1) {
    mode = "exact";
    responseMessage = "Encontre una coincidencia exacta.";
  } else if (available.length > 1 && cls.model && groups.length > 1) {
    mode = "quality_groups";
    responseMessage = "Elegir calidad.";
  } else if (available.length > 1 && available.length <= 15) {
    mode = "variants";
    responseMessage = "Encontre varias opciones.";
  } else if (available.length > 15) {
    mode = "broad";
    responseMessage = "Hay muchos resultados. Falta precisar modelo, marca o repuesto.";
  }

  if (matches.length) {
    if (!cls.category) missing.push("category");
    if (!cls.model) missing.push("model");
    if (!cls.brand) missing.push("brand");
  }

  return {
    query: cls,
    mode,
    message: responseMessage,
    total: matches.length,
    availableTotal: available.length,
    missing,
    products: visible.slice(0, 15),
    groups: groups.map((group) => ({ ...group, products: group.products.slice(0, 8) })),
    categories: broad.categories,
    usdToArs: broad.usdToArs,
  };
}
