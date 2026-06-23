import type { MongoProduct } from "@/lib/mongodb";
import { colorLabel, colorMatchesText, detectProductColor, uniqueColors } from "@/lib/productColors";

export type AltaClassification = {
  sku: string | null;
  partType: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  quality: string | null;
  excludedPartTypes: string[];
  confidence: number;
};

export type AltaQualityGroup = {
  label: string;
  replacementBrand: string | null;
  quality: string | null;
  technology: string | null;
  variant: string | null;
  products: MongoProduct[];
};

export type AltaBotReply =
  | { mode: "ai" }
  | { mode: "clarify"; text: string; classification: AltaClassification }
  | { mode: "not_found"; text: string; classification: AltaClassification }
  | { mode: "direct"; text: string; product: MongoProduct; classification: AltaClassification }
  | { mode: "quality_menu"; text: string; groups: AltaQualityGroup[]; classification: AltaClassification };

const BRANDS = [
  "IPHONE", "SAMSUNG", "MOTOROLA", "XIAOMI", "NOKIA", "TCL", "HUAWEI", "HONOR",
  "ALCATEL", "LG", "OPPO", "VIVO", "REALME", "ZTE", "ASUS", "INFINIX", "TECNO",
  "NUBIA", "ITEL",
];

const BRAND_ALIASES: Record<string, string[]> = {
  IPHONE: ["iphone", "iph", "ip", "apple"],
  SAMSUNG: ["samsung", "galaxy"],
  MOTOROLA: ["motorola", "moto"],
  XIAOMI: ["xiaomi", "redmi", "poco", "mi"],
  NOKIA: ["nokia"],
  TCL: ["tcl"],
  HUAWEI: ["huawei"],
  HONOR: ["honor"],
  ALCATEL: ["alcatel"],
  LG: ["lg"],
  OPPO: ["oppo"],
  VIVO: ["vivo"],
  REALME: ["realme"],
  ZTE: ["zte", "blade"],
  ASUS: ["asus", "zenfone"],
  INFINIX: ["infinix"],
  TECNO: ["tecno"],
  NUBIA: ["nubia"],
  ITEL: ["itel"],
};

const PART_ALIASES: Record<string, string[]> = {
  "PLACA DE CARGA": ["placa de carga", "placa carga", "pin carga", "puerto carga", "conector carga", "dock"],
  "FLEX DE CARGA": ["flex de carga", "flex carga"],
  "FLEX MAIN": ["flex main", "main flex"],
  "POWER FLEX": ["power flex", "flex power", "flex encendido", "boton encendido"],
  MODULO: ["modulo", "modulos", "m dulo", "m dulos", "pantalla", "display", "lcd", "pantalla completa"],
  "VIDRIO TEMPLADO": ["vidrio templado", "templado", "vidrio protector", "protector de pantalla", "protector", "lamina", "hidrogel"],
  GLASS: ["glass", "glas", "tactil", "touch", "oca"],
  BATERIA: ["bateria", "battery", "pila"],
  CAMARA: ["camara", "camera", "frontal", "trasera"],
  "VISOR DE CAMARA": ["visor de camara", "lente camara", "vidrio camara"],
  TAPA: ["tapa", "tapas", "contratapa", "back cover", "carcasa"],
  PARLANTE: ["parlante", "altavoz", "speaker", "buzzer", "campanilla"],
  "PORTA SIM": ["porta sim", "zocalo sim", "bandeja sim", "slot sim"],
  "SENSOR HUELLA": ["sensor huella", "huella"],
  FPC: ["fpc"],
  CHASIS: ["chasis", "marco completo", "frame"],
  ANTENA: ["antena", "flex antena", "cable antena", "coaxial", "senal", "señal"],
  ACCESORIO: ["accesorio", "accesorios", "tpu"],
  CARGADOR: ["cargador", "cargadores", "charger", "carga rapida", "carga rápida", "fuente", "adaptador"],
  MEMORIA: ["memoria", "memorias", "memoria sd", "memorias sd", "micro sd", "microsd", "tarjeta sd", "pendrive"],
  CELULAR: ["celular", "celulares", "telefono", "telefonos", "smartphone", "equipo", "equipos"],
  HERRAMIENTAS: [
    "herramienta", "herramientas", "insumo", "insumos", "separador", "estano", "estaño",
    "flux", "pasta", "pasta termica", "pasta térmica", "termica", "térmica", "precalentadora",
    "precalentadoras", "cautin", "cautín", "soporte", "pinza", "pinzas", "destornillador",
    "destornilladores", "multicargador", "passta", "estacion", "estacion de soldado",
    "estacion de soldadura", "soldado", "soldador", "soldadura", "calor", "aifen", "aife",
    "qianli", "relife", "mechanic", "amaoe", "luowei", "ycs", "amtech", "hilo", "jumper",
    "malla", "desoldante", "wick", "trinocular", "microscopio", "extractor de humo",
  ],
};

const CATEGORY_MATCH: Record<string, string[]> = {
  "PLACA DE CARGA": ["placa de carga", "flex de carga", "pin de carga", "pines de carga"],
  "FLEX DE CARGA": ["flex de carga"],
  "FLEX MAIN": ["main flex"],
  "POWER FLEX": ["power flex"],
  MODULO: ["modulo"],
  "VIDRIO TEMPLADO": ["vidrio templado", "vidrios templados", "templado", "protector de pantalla", "lamina", "hidrogel"],
  GLASS: ["glass"],
  BATERIA: ["bateria"],
  CAMARA: ["camara"],
  "VISOR DE CAMARA": ["visor de camara"],
  TAPA: ["tapa"],
  PARLANTE: ["parlante", "speaker", "buzzer"],
  "PORTA SIM": ["porta sim", "socalo sim"],
  "SENSOR HUELLA": ["sensor huella"],
  FPC: ["fpc"],
  CHASIS: ["chasis"],
  ANTENA: ["antena", "flex antena", "cable antena", "coaxial", "blindaje"],
  ACCESORIO: ["accesorio"],
  CARGADOR: ["cargador", "accesorio", "herramienta"],
  MEMORIA: ["memoria", "accesorio"],
  CELULAR: ["celular"],
  HERRAMIENTAS: ["herramienta", "insumo"],
};

const PRODUCT_MENU_PARTS = new Set(["HERRAMIENTAS", "CARGADOR", "MEMORIA", "CELULAR", "ACCESORIO", "VIDRIO TEMPLADO"]);
const GENERIC_ACCESSORY_PARTS = new Set(["HERRAMIENTAS", "CARGADOR", "MEMORIA", "ACCESORIO"]);

const QUALITY_ORDER = [
  "VEZR", "SUNLONG", "JCID", "BEST", "MASTERFIX", "FASTFIX", "FOXCONN", "MECHANIC",
  "ORIGINAL", "SERVICE PACK", "SOFT OLED", "HARD OLED", "AMOLED", "OLED", "INCELL",
  "FHD", "HD", "TFT", "AAA", "C/M", "S/M", "TURBO", "JK", "DD", "ESTANDAR",
];

const QUALITY_ALIASES: Record<string, string[]> = {
  ORIGINAL: ["original", "genuino", "oem"],
  "SERVICE PACK": ["service pack", "svc"],
  VEZR: ["vezr"],
  BEST: ["best"],
  MASTERFIX: ["masterfix"],
  FASTFIX: ["fastfix", "fast fix"],
  FOXCONN: ["foxconn"],
  MECHANIC: ["mechanic"],
  "SOFT OLED": ["soft oled"],
  "HARD OLED": ["hard oled"],
  AMOLED: ["amoled"],
  OLED: ["oled"],
  INCELL: ["incell"],
  FHD: ["fhd"],
  HD: ["hd"],
  TFT: ["tft"],
  AAA: ["aaa"],
  "C/M": ["c/m", "con marco"],
  "S/M": ["s/m", "sin marco"],
  TURBO: ["turbo"],
  SUNLONG: ["sunlong"],
  JCID: ["jcid"],
  JK: ["jk"],
  DD: ["dd"],
};

const REPLACEMENT_BRANDS = [
  "VEZR", "SUNLONG", "JCID", "BEST", "MASTERFIX", "FASTFIX", "FOXCONN", "MECHANIC", "JK", "DD",
];
const QUALITY_TECH = [
  "SOFT OLED", "HARD OLED", "AMOLED", "OLED", "INCELL", "FHD", "HD", "TFT",
];
const QUALITY_GRADES = ["ORIGINAL", "SERVICE PACK", "AAA", "TURBO"];
const QUALITY_VARIANTS = ["C/M", "S/M"];

const PRODUCT_WORDS = [
  ...Object.values(PART_ALIASES).flat(),
  ...Object.values(BRAND_ALIASES).flat(),
  "precio", "stock", "tenes", "tienen", "busco", "necesito", "quiero", "repuesto",
  "repuestos", "modelo", "calidad", "calidades", "unidad", "unidades",
  "color", "colores",
];

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

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s/+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordIncludes(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(text);
}

function findAlias(text: string, aliases: Record<string, string[]>): string | null {
  const entries = Object.entries(aliases).sort((a, b) => {
    const longestA = Math.max(...a[1].map((alias) => norm(alias).length));
    const longestB = Math.max(...b[1].map((alias) => norm(alias).length));
    return longestB - longestA;
  });
  for (const [key, values] of entries) {
    if (values.some((alias) => wordIncludes(text, norm(alias)))) return key;
  }
  return null;
}

function findAliases(text: string, aliases: Record<string, string[]>): string[] {
  return Object.keys(aliases).filter((key) =>
    aliases[key].some((alias) => wordIncludes(text, norm(alias)))
  );
}

function stripNegatedPartAliases(text: string): string {
  let cleaned = ` ${text} `;
  for (const aliases of Object.values(PART_ALIASES)) {
    for (const alias of aliases.map(norm).sort((a, b) => b.length - a.length)) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      cleaned = cleaned.replace(new RegExp(`\\b(?:no|sin)\\s+${escaped}\\b`, "gi"), " ");
    }
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function extractSku(raw: string): string | null {
  const prefixed = raw.match(/\bc[oó]d(?:igo)?\.?\s*#?\s*([A-Z]{1,6}\.?\d{2,6}|\d{3,6})\b/i);
  if (prefixed) return prefixed[1].toUpperCase();
  const numeric = raw.match(/\b(\d{3,6})\b/i);
  return numeric ? numeric[1] : null;
}

function extractBrand(raw: string): string | null {
  const text = ` ${norm(raw)} `;
  const alias = findAlias(text, BRAND_ALIASES);
  if (alias) return alias;
  const up = raw.toUpperCase();
  return BRANDS.find((brand) => up.includes(brand)) ?? null;
}

function extractModel(raw: string, brand: string | null): string | null {
  const clean = norm(raw).toUpperCase();

  if (brand === "IPHONE") {
    for (const model of IPHONE_MODELS) {
      const re = new RegExp(`\\b${model.replace(/\s+/g, "\\s+")}\\b`);
      if (re.test(clean)) return model;
    }
  }

  if (brand === "SAMSUNG") {
    const note = clean.match(/\b(NOTE\s*\d{1,2}(?:\s*(?:ULTRA|PLUS|FE|PRO))?|TAB\s*[A-Z]?\s*\d{1,2}(?:\s*(?:PLUS|FE|ULTRA|S))?)\b/);
    if (note) return note[1].replace(/\s+/g, " ").trim();
    const model = clean.match(/\b([ASMJFCB]\s*\d{2,3}\s*(?:5G|4G)?[A-Z]?\s*(?:ULTRA|PLUS|FE|LITE|PRO|CORE|\+)?)\b/);
    if (model) return model[1].replace(/\s+/g, " ").trim();
  }

  if (brand === "MOTOROLA") {
    const model = clean.match(/\b(?:MOTO\s+)?([GES]\s*\d{1,3}[A-Z]?\s*(?:PLAY|PLUS|POWER|LITE|PRO|ULTRA|EDGE|STYLUS)?|(?:EDGE\s*)?\d{1,3}\s*(?:NEO|FUSION|PRO|ULTRA|LITE)?)\b/);
    if (model) return model[1].replace(/\s+/g, " ").trim();
  }

  if (brand === "XIAOMI") {
    const model = clean.match(/\b((?:REDMI\s*)?(?:NOTE\s*)?\d{1,2}[A-Z]?(?:\s*(?:PRO|PLUS|ULTRA|C))?|POCO\s*[XMFC]\d{1,2}(?:\s*PRO)?|MI\s*\d{1,2}(?:\s*LITE|\s*PRO)?)\b/);
    if (model) return model[1].replace(/\s+/g, " ").trim();
  }

  if (brand === "NUBIA") {
    const model = clean.match(/\b((?:NEO\s*)?\d{1,2}(?:\s*(?:PRO|PLUS|MAX|5G|4G))?|RED\s*MAGIC\s*\d{1,2}(?:\s*PRO)?)\b/);
    if (model) return model[1].replace(/\s+/g, " ").trim();
  }

  const generic = clean.match(/\b([A-Z]{0,3}\d{1,3}[A-Z]?(?:\s*(?:PRO MAX|PRO|PLUS|MAX|PLAY|POWER|LITE|ULTRA|NOTE|EDGE|CORE|NEO|4G|5G))?)\b/);
  if (generic && !/^\d{4}$/.test(generic[1])) return generic[1].replace(/\s+/g, " ").trim();
  return null;
}

function productHaystack(product: MongoProduct): string {
  return [
    product.searchText,
    product.name,
    product.category,
    product.sku,
    product.description,
    product.partBrand,
    product.deviceBrand,
    product.deviceModel,
    product.color,
    product.tags,
    product.context,
    product.categoryTags,
    product.categoryContext,
  ].flat().filter(Boolean).join(" ");
}

function detectProductBrand(product: MongoProduct): string | null {
  const deviceBrand = extractBrand(product.deviceBrand);
  if (deviceBrand) return deviceBrand;
  return extractBrand(productHaystack(product));
}

function detectProductQuality(product: MongoProduct): string {
  return detectReplacementMeta(product).label;
}

function detectReplacementMeta(product: MongoProduct) {
  const full = norm(productHaystack(product));
  const found = Object.keys(QUALITY_ALIASES).filter((quality) =>
    QUALITY_ALIASES[quality].some((alias) => wordIncludes(full, norm(alias)))
  );
  const replacementBrand = REPLACEMENT_BRANDS.find((quality) => found.includes(quality)) ?? null;
  const quality = QUALITY_GRADES.find((grade) => found.includes(grade)) ?? null;
  const technology = QUALITY_TECH.find((tech) => found.includes(tech)) ?? null;
  const variant = QUALITY_VARIANTS.find((v) => found.includes(v)) ?? null;
  const label = [replacementBrand, quality, technology, variant].filter(Boolean).join(" ") || "ESTANDAR";
  return { label, replacementBrand, quality, technology, variant };
}

function productMetadataText(product: MongoProduct): string {
  return norm([
    product.tags,
    product.context,
    product.categoryTags,
    product.categoryContext,
  ].flat().filter(Boolean).join(" "));
}

function partSignals(partType: string): string[] {
  return [
    ...(CATEGORY_MATCH[partType] ?? [partType]),
    ...(PART_ALIASES[partType] ?? []),
  ].map(norm).filter(Boolean);
}

function textMatchesAnySignal(text: string, signals: string[]): boolean {
  return signals.some((signal) => wordIncludes(text, signal) || text.includes(signal));
}

function categoryMatches(product: MongoProduct, partType: string): boolean {
  const category = norm(product.category);
  const metadata = productMetadataText(product);
  const partText = norm([
    product.name,
    product.category,
    product.tags,
    product.categoryTags,
    product.context,
    product.categoryContext,
  ].flat().filter(Boolean).join(" "));
  const targets = (CATEGORY_MATCH[partType] ?? [partType]).map(norm);
  const signals = partSignals(partType);
  return targets.some((target) => category.includes(target)) ||
    textMatchesAnySignal(metadata, signals) ||
    textMatchesAnySignal(partText, signals);
}

function requestedPartMatches(product: MongoProduct, partType: string): boolean {
  const category = norm(product.category);
  const metadata = productMetadataText(product);
  const productText = norm([
    product.name,
    product.category,
    product.tags,
    product.context,
    product.categoryTags,
    product.categoryContext,
  ].flat().filter(Boolean).join(" "));
  const targets = (CATEGORY_MATCH[partType] ?? [partType]).map(norm);
  const signals = partSignals(partType);
  return targets.some((target) => category.includes(target)) ||
    textMatchesAnySignal(metadata, signals) ||
    textMatchesAnySignal(productText, signals);
}

function modelMatches(product: MongoProduct, model: string): boolean {
  const productName = productHaystack(product).toUpperCase();
  const productDeviceModel = norm(product.deviceModel);
  const wantedModel = norm(model);
  if (productDeviceModel) {
    if (productDeviceModel === wantedModel) return true;
    if (productDeviceModel.endsWith(` ${wantedModel}`)) return true;
    if (wantedModel.includes(" ") && productDeviceModel.endsWith(wantedModel)) return true;
  }
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const suffixes = ["MAX", "PLUS", "ULTRA", "MINI", "LITE", "FE", "PRO"];
  const modelParts = model.toUpperCase().split(/\s+/);
  const exclusions = suffixes.filter((s) => !modelParts.includes(s));
  const lookAhead = exclusions.length ? `(?!\\s+(?:${exclusions.join("|")})(?:\\s|$))` : "";
  return new RegExp(`(^|[\\s/(,-])${escaped}${lookAhead}([\\s/),+-]|$)`).test(productName);
}

function classifyProduct(product: MongoProduct) {
  const brand = detectProductBrand(product);
  return {
    brand,
    model: product.deviceModel || extractModel(productHaystack(product), brand),
    quality: detectProductQuality(product),
  };
}

export function classifyAltaQuery(query: string): AltaClassification {
  const text = norm(query);
  const positiveText = stripNegatedPartAliases(text);
  const sku = extractSku(query);
  const partType = findAlias(positiveText, PART_ALIASES);
  const excludedPartTypes = findAliases(text, PART_ALIASES)
    .filter((part) => !partType || part !== partType)
    .filter((part) => new RegExp(`\\b(?:no|sin)\\s+${part.toLowerCase().replace(/\s+/g, "\\s+")}\\b`).test(text));
  const brand = extractBrand(query);
  const quality = findAlias(text, QUALITY_ALIASES);
  const model = extractModel(query, brand);
  const color = detectProductColor(query);
  const detected = [sku, partType, brand, model, color, quality].filter(Boolean).length;
  return { sku, partType, brand, model, color, quality, excludedPartTypes, confidence: Math.min(detected / 3, 1) };
}

export function isAltaProductQuery(query: string): boolean {
  const text = norm(query);
  return PRODUCT_WORDS.some((word) => text.includes(norm(word))) || Boolean(classifyAltaQuery(query).sku);
}

export function splitAltaQueries(query: string): string[] {
  const lines = query
    .replace(/^[*\-•]\s*/gm, "")
    .split(/\n|;|\s+\+\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
  return lines.length > 1 ? lines.slice(0, 4) : [query];
}

function filterProducts(products: MongoProduct[], cls: AltaClassification): MongoProduct[] {
  let result = products.filter((p) => p.price > 0);

  if (cls.sku) {
    const exact = result.filter((p) => String(p.sku ?? "").toUpperCase() === cls.sku);
    if (exact.length) return exact;
    result = result.filter((p) => String(p.sku ?? "").toUpperCase().includes(cls.sku as string));
    if (result.length) return sortProducts(result);
  }

  if (cls.excludedPartTypes.length) {
    result = result.filter((p) => !cls.excludedPartTypes.some((partType) => categoryMatches(p, partType)));
  }
  if (cls.partType) result = result.filter((p) => categoryMatches(p, cls.partType as string));
  if (cls.brand) {
    const withBrand = result.filter((p) => detectProductBrand(p) === cls.brand || norm(productHaystack(p)).includes(norm(cls.brand)));
    if (withBrand.length > 0 || !cls.partType || !GENERIC_ACCESSORY_PARTS.has(cls.partType)) result = withBrand;
  }
  if (cls.model) {
    const withModel = result.filter((p) => modelMatches(p, cls.model as string));
    if (withModel.length > 0 || !cls.partType || !GENERIC_ACCESSORY_PARTS.has(cls.partType)) result = withModel;
  }
  if (cls.color) result = result.filter((p) => productColorMatches(p, cls.color as string));
  if (cls.quality) {
    const withQuality = result.filter((p) => detectProductQuality(p) === cls.quality || norm(productHaystack(p)).includes(norm(cls.quality)));
    if (withQuality.length > 0) result = withQuality;
  }

  return sortProducts(result);
}

function matchesRequestedProduct(product: MongoProduct, cls: AltaClassification): boolean {
  if (product.price <= 0) return false;
  if (cls.sku) return String(product.sku ?? "").toUpperCase().includes(cls.sku);
  if (cls.excludedPartTypes.some((partType) => categoryMatches(product, partType))) return false;
  if (cls.partType && !requestedPartMatches(product, cls.partType)) return false;
  if (cls.brand && detectProductBrand(product) !== cls.brand && !norm(productHaystack(product)).includes(norm(cls.brand))) return false;
  if (cls.model && !modelMatches(product, cls.model)) return false;
  if (cls.color && !productColorMatches(product, cls.color)) return false;
  if (cls.quality && detectProductQuality(product) !== cls.quality && !norm(productHaystack(product)).includes(norm(cls.quality))) return false;
  return true;
}

function productColor(product: MongoProduct): string | null {
  return product.color ?? detectProductColor(product.name);
}

function productColorMatches(product: MongoProduct, color: string): boolean {
  return productColor(product) === color || colorMatchesText(product.name, color) || colorMatchesText(product.tags.join(" "), color);
}

const QUERY_SYNONYMS: Record<string, string[]> = {
  glas: ["glass"],
  vidirio: ["vidrio", "glass", "oca"],
  passta: ["pasta"],
  estano: ["estaño"],
  soldado: ["soldador", "soldadura"],
  aife: ["aifen"],
  hilo: ["jumper", "estaño"],
  malla: ["desoldante", "wick"],
};

function expandedQueryTokens(query: string): string[] {
  const tokens = norm(query)
    .split(/\s+/)
    .filter((token) => token.length > 2 || /^\d+$/.test(token));
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    for (const synonym of QUERY_SYNONYMS[token] ?? []) expanded.add(norm(synonym));
  }
  return Array.from(expanded);
}

function tagMatchesQuery(tag: string, queryText: string, tokens: string[]): boolean {
  const normalizedTag = norm(tag);
  if (!normalizedTag) return false;
  return tokens.includes(normalizedTag) || wordIncludes(queryText, normalizedTag);
}

function looseProductFallback(products: MongoProduct[], query: string, cls: AltaClassification): MongoProduct[] {
  const tokens = expandedQueryTokens(query).filter((token) => !["cod", "codigo", "para"].includes(token));
  if (!tokens.length) return [];

  return sortProducts(products.filter((product) => {
    if (product.price <= 0) return false;
    if (cls.excludedPartTypes.some((partType) => categoryMatches(product, partType))) return false;
    if (cls.partType && !categoryMatches(product, cls.partType)) return false;
    if (cls.brand && detectProductBrand(product) !== cls.brand && !norm(productHaystack(product)).includes(norm(cls.brand))) return false;
    if (cls.model && !modelMatches(product, cls.model)) return false;
    if (cls.color && !productColorMatches(product, cls.color)) return false;
    const haystack = norm(productHaystack(product));
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += /^\d+$/.test(token) ? 3 : 1;
    }
    if (cls.partType && categoryMatches(product, cls.partType)) score += 2;
    if (cls.brand && (detectProductBrand(product) === cls.brand || haystack.includes(norm(cls.brand)))) score += 2;
    if (cls.model && modelMatches(product, cls.model)) score += 2;
    return score >= Math.min(3, Math.max(2, tokens.length - 1));
  }));
}

function metadataExactMatches(products: MongoProduct[], query: string, includeContext = true): MongoProduct[] {
  const tokens = expandedQueryTokens(query).filter((token) => !["cod", "codigo", "para"].includes(token));
  if (!tokens.length) return [];
  const queryText = ` ${norm(query)} `;

  const exactProductTagMatches = sortProducts(products.filter((product) => {
    if (product.price <= 0) return false;
    return (product.tags ?? []).some((tag) => tagMatchesQuery(tag, queryText, tokens));
  }));

  const exactCategoryTagMatches = sortProducts(products.filter((product) => {
    if (product.price <= 0) return false;
    return (product.categoryTags ?? []).some((tag) => tagMatchesQuery(tag, queryText, tokens));
  }));
  const exactTagMatches = sortProducts(uniqueProducts([...exactProductTagMatches, ...exactCategoryTagMatches]));
  if (exactTagMatches.length) return exactTagMatches;

  if (!includeContext) return [];

  return sortProducts(products.filter((product) => {
    if (product.price <= 0) return false;
    const metadata = ` ${norm([
      product.context,
      product.categoryTags,
      product.categoryContext,
    ].flat().filter(Boolean).join(" "))} `;
    if (!metadata) return false;
    return tokens.length <= 1
      ? tokens.some((token) => wordIncludes(metadata, token))
      : tokens.every((token) => wordIncludes(metadata, token));
  }));
}

function sortProducts(products: MongoProduct[]): MongoProduct[] {
  return [...products].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if ((a.stock > 0) !== (b.stock > 0)) return a.stock > 0 ? -1 : 1;
    return String(a.sku ?? "").localeCompare(String(b.sku ?? ""));
  });
}

function uniqueProducts(products: MongoProduct[]): MongoProduct[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    const key = product.id || String(product.sku ?? "") || product.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupByQuality(products: MongoProduct[]): AltaQualityGroup[] {
  const map = new Map<string, { meta: ReturnType<typeof detectReplacementMeta>; products: MongoProduct[] }>();
  for (const product of uniqueProducts(products)) {
    const meta = detectReplacementMeta(product);
    const current = map.get(meta.label) ?? { meta, products: [] };
    current.products.push(product);
    map.set(meta.label, current);
  }

  return Array.from(map.values())
    .map(({ meta, products }) => ({ ...meta, products: sortProducts(products) }))
    .sort((a, b) => {
      const aHasStock = a.products.some((product) => product.available);
      const bHasStock = b.products.some((product) => product.available);
      if (aHasStock !== bHasStock) return aHasStock ? -1 : 1;
      const ai = QUALITY_ORDER.findIndex((quality) => a.label.includes(quality));
      const bi = QUALITY_ORDER.findIndex((quality) => b.label.includes(quality));
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

function groupByProduct(products: MongoProduct[]): AltaQualityGroup[] {
  return sortProducts(uniqueProducts(products)).slice(0, 10).map((product) => ({
    label: shortName(product, 38),
    replacementBrand: null,
    quality: null,
    technology: null,
    variant: null,
    products: [product],
  }));
}

function groupByColor(products: MongoProduct[]): AltaQualityGroup[] {
  const map = new Map<string, MongoProduct[]>();
  for (const product of uniqueProducts(products)) {
    const color = productColor(product) ?? "sin color";
    map.set(color, [...(map.get(color) ?? []), product]);
  }
  return Array.from(map.entries())
    .map(([color, colorProducts]) => ({
      label: color === "sin color" ? "Sin color" : colorLabel(color),
      replacementBrand: null,
      quality: null,
      technology: null,
      variant: color,
      products: sortProducts(colorProducts),
    }))
    .sort((a, b) => {
      const aHasStock = a.products.some((product) => product.available);
      const bHasStock = b.products.some((product) => product.available);
      if (aHasStock !== bHasStock) return aHasStock ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

function labelForSearch(cls: AltaClassification): string {
  return [cls.partType, cls.brand, cls.model].filter(Boolean).join(" ") || "producto";
}

function shortName(product: MongoProduct, max = 54): string {
  const name = product.name.replace(/\s+/g, " ").trim();
  return name.length <= max ? name : `${name.slice(0, max - 1).trim()}...`;
}

function formatARSValue(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatARS(product: MongoProduct): string {
  return formatARSValue(product.promoPriceARS ?? product.priceARS);
}

export function buildAltaProductCaption(product: MongoProduct): string {
  const price = product.promoPriceARS
    ? `${formatARSValue(product.promoPriceARS)} (antes ${formatARSValue(product.priceARS)})`
    : formatARS(product);
  return [
    `*${product.name}*`,
    product.sku ? `SKU: ${product.sku}` : null,
    product.category ? `Categoria: ${product.category}` : null,
    productColor(product) ? `Color: ${colorLabel(productColor(product))}` : null,
    `Precio: ${price}`,
    product.available ? "Disponible" : "Sin stock",
  ].filter(Boolean).join("\n");
}

export function buildAltaProductBotReply(products: MongoProduct[], query: string, forceSearch = false): AltaBotReply {
  if (!forceSearch && !isAltaProductQuery(query)) return { mode: "ai" };

  const cls = classifyAltaQuery(query);
  if (!forceSearch && !cls.partType && !cls.brand && !cls.model && !cls.sku) return { mode: "ai" };

  if (!cls.partType && (cls.brand || cls.model) && !cls.sku) {
    return {
      mode: "clarify",
      classification: cls,
      text: `Te busco ${labelForSearch(cls)}, pero decime que pieza necesitas: modulo, bateria, placa de carga, tapa, camara o flex.`,
    };
  }

  if (cls.partType && !cls.model && !cls.sku && !PRODUCT_MENU_PARTS.has(cls.partType)) {
    return {
      mode: "clarify",
      classification: cls,
      text: `Perfecto, ${cls.partType.toLowerCase()}. Pasame marca y modelo exacto, por ejemplo: "${cls.partType.toLowerCase()} samsung a52".`,
    };
  }

  const metadataMatches = metadataExactMatches(products, query, forceSearch);
  let all = metadataMatches.length ? metadataMatches : filterProducts(products, cls);
  all = all.filter((product) => matchesRequestedProduct(product, cls));
  if (!all.length) all = looseProductFallback(products, query, cls).filter((product) => matchesRequestedProduct(product, cls));
  all = uniqueProducts(all);
  const searchLabel = labelForSearch(cls);

  if (!all.length) {
    if (cls.color) {
      const withoutColor = { ...cls, color: null };
      const sameProduct = filterProducts(products, withoutColor).filter((product) => matchesRequestedProduct(product, withoutColor));
      const colors = uniqueColors(sameProduct.map(productColor));
      if (colors.length) {
        return {
          mode: "not_found",
          classification: cls,
          text: `No encontre ${searchLabel} ${colorLabel(cls.color).toLowerCase()} en el catalogo. Colores disponibles: ${colors.map(colorLabel).join(", ")}.`,
        };
      }
    }
    return {
      mode: "not_found",
      classification: cls,
      text: `No encontre ${searchLabel} en el catalogo. Si queres, pasame el modelo exacto o el SKU y lo reviso de nuevo.`,
    };
  }

  if (cls.model && !cls.brand) {
    const brands = Array.from(new Set(all.map(detectProductBrand).filter(Boolean)));
    if (brands.length > 1) {
      return {
        mode: "clarify",
        classification: cls,
        text: `Tengo ${cls.model} en varias marcas (${brands.join(", ")}). Decime la marca exacta para pasarte solo ese producto.`,
      };
    }
  }

  const colorGroups = cls.partType === "TAPA" && !cls.color ? groupByColor(all).filter((group) => group.variant !== "sin color") : [];
  const groups = colorGroups.length > 1
    ? colorGroups
    : cls.partType && PRODUCT_MENU_PARTS.has(cls.partType)
      ? groupByProduct(all)
      : groupByQuality(all);
  if (groups.length > 1) {
    const lines = groups.slice(0, 10).map((group, index) => {
      const product = group.products[0];
      const stock = product.available ? "Disponible" : "Sin stock";
      return `${index + 1}. ${group.label} - ${shortName(product, 42)} - ${formatARS(product)} - ${stock}`;
    });
    return {
      mode: "quality_menu",
      classification: cls,
      groups: groups.slice(0, 10),
      text: `Tengo estas opciones para ${searchLabel}:\n\n${lines.join("\n")}\n\nElegi marca/calidad y te paso la ficha para agregar al carrito.`,
    };
  }

  const firstGroup = groups[0];
  const product = firstGroup.products.find((p) => p.available) ?? firstGroup.products[0];
  return {
    mode: "direct",
    classification: cls,
    product,
    text: `Resultado para ${searchLabel}:\n${shortName(product)}`,
  };
}
