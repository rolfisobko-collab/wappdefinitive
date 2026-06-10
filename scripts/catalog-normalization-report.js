const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const uri = "mongodb://leandrosobko_db_user:39kokOttcCd8gZn1@ac-7pyfrbt-shard-00-00.qkjc22r.mongodb.net:27017,ac-7pyfrbt-shard-00-01.qkjc22r.mongodb.net:27017,ac-7pyfrbt-shard-00-02.qkjc22r.mongodb.net:27017/test?ssl=true&authSource=admin&retryWrites=true&w=majority";

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s/+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(norm(word)));
}

function suggestCategory(name) {
  const n = norm(name);
  if (includesAny(n, ["visor de camara", "lente camara", "vidrio camara"])) return "Visor de Camara";
  if (includesAny(n, ["modulo", "display", "pantalla", "lcd", "oled", "incell"])) return "Modulos";
  if (includesAny(n, ["bateria", "battery", "pila"])) return "Baterias";
  if (includesAny(n, ["camara frontal", "camara trasera", "camara delantera"])) return "Camaras";
  if (includesAny(n, ["glass", "oca", "tactil", "touch", "vidrio templado", "hidrogel"])) return "Glass";
  if (includesAny(n, ["chasis", "marco completo"])) return "Chasis";
  if (includesAny(n, ["placa de carga", "pin carga", "puerto carga"])) return "Placa de Carga";
  if (includesAny(n, ["flex main", "main flex"])) return "Main Flex";
  if (includesAny(n, ["flex de carga", "flex carga"])) return "Flex de Carga";
  if (includesAny(n, ["tapa", "contratapa", "back cover"])) return "Tapas";
  if (includesAny(n, ["parlante", "speaker", "buzzer", "altavoz"])) return "Parlante";
  if (includesAny(n, ["porta sim", "bandeja sim", "socalo sim"])) return "Porta Sim";
  if (includesAny(n, [
    "herramienta", "insumo", "estacion", "soldador", "soldadura", "aifen", "qianli",
    "relife", "mechanic", "amaoe", "luowei", "ycs", "amtech", "estaño", "estano",
    "flux", "pasta", "separador", "trinocular", "microscopio", "destornillador",
    "pinza", "hilo", "malla", "desoldante", "alcohol", "pegamento",
  ])) return "Herramientas e insumos";
  if (includesAny(n, ["cargador", "cable", "memoria", "pendrive", "microsd", "funda", "protector"])) return "Accesorios";
  return null;
}

function suggestToolSubcategory(name) {
  const n = norm(name);
  if (includesAny(n, ["alcohol isopropilico"])) return "ALCOHOL ISOPROPILICO";
  if (includesAny(n, ["pegamento", "adhesivo"])) return "PEGAMENTO";
  if (includesAny(n, ["tornillo", "blindaje"])) return "TORNILLOS/BLINDAJES IPHONE";
  if (includesAny(n, ["board", "jc", "jcid"])) return "BOARD IPHONE";
  if (includesAny(n, ["estacion", "soldador", "soldadura", "calor", "precalentadora"])) return "HERRAMIENTAS VARIAS";
  if (includesAny(n, ["trinocular", "microscopio", "soporte", "separador", "destornillador", "pinza"])) return "HERRAMIENTAS VARIAS";
  if (includesAny(n, ["estaño", "estano", "flux", "pasta", "hilo", "malla", "desoldante"])) return "HERRAMIENTAS VARIAS";
  return null;
}

function inferTagsAndContext(product) {
  const n = norm(product.name);
  const tags = new Set();
  let context = "";

  const part = suggestCategory(product.name);
  if (part) tags.add(part.toLowerCase());

  for (const brand of ["iphone", "samsung", "motorola", "moto", "xiaomi", "redmi", "poco", "tcl", "zte", "honor", "huawei", "oppo", "realme", "vivo", "lg", "nokia"]) {
    if (n.includes(brand)) tags.add(brand);
  }
  for (const quality of ["vezr", "sunlong", "jcid", "best", "masterfix", "fastfix", "foxconn", "mechanic", "oled", "incell", "fhd", "tft", "original", "aaa", "turbo"]) {
    if (n.includes(quality)) tags.add(quality);
  }

  const modelTokens = product.name.match(/\b(?:A|M|G|E|S|J|NOTE|EDGE)?\s?\d{1,3}\s?(?:PRO MAX|PRO|PLUS|MAX|ULTRA|FE|LITE|PLAY|POWER|NEO|4G|5G)?\b/gi) ?? [];
  for (const token of modelTokens.slice(0, 4)) tags.add(norm(token));

  if (includesAny(n, ["visor de camara", "lente camara", "vidrio camara"])) {
    tags.add("lente camara");
    tags.add("vidrio camara");
    context = "Es visor/lente/vidrio externo de camara. No es camara frontal ni camara trasera completa.";
  } else if (includesAny(n, ["camara frontal", "camara trasera", "camara delantera"])) {
    context = "Es camara completa del equipo, no visor/lente externo de camara.";
  } else if (includesAny(n, ["glass", "oca"])) {
    context = "Es glass/tactil/OCA, no modulo completo de pantalla.";
  } else if (includesAny(n, ["estacion", "soldador", "trinocular", "estaño", "estano", "flux", "hilo", "malla"])) {
    context = "Producto de herramientas e insumos para tecnico reparador.";
  }

  return { tags: Array.from(tags).filter(Boolean), context };
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("test");
  const stock = db.collection("stock");
  const cats = db.collection("stockCategories");

  const [products, categories] = await Promise.all([
    stock.find({}).project({ name: 1, sku: 1, category: 1, quantity: 1, tags: 1, context: 1 }).toArray(),
    cats.find({}).toArray(),
  ]);

  const catById = new Map(categories.map((cat) => [String(cat._id), cat]));
  const catByName = new Map(categories.map((cat) => [cat.name, cat]));
  const rootCategories = categories.filter((cat) => !cat.parentId);
  const subcategories = categories.filter((cat) => cat.parentId);

  const summary = {
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    categoryCount: categories.length,
    rootCategoryCount: rootCategories.length,
    subcategoryCount: subcategories.length,
    productsByCategoryRef: { id: 0, name: 0, unmatched: 0, empty: 0, subcategory: 0 },
    productsWithTags: 0,
    productsWithContext: 0,
    categoriesWithTags: categories.filter((cat) => Array.isArray(cat.tags) && cat.tags.length).length,
    categoriesWithContext: categories.filter((cat) => String(cat.context ?? "").trim()).length,
  };

  const categoryIssues = [];
  const suggestedUpdates = [];

  for (const product of products) {
    const categoryValue = String(product.category ?? "");
    const byId = catById.get(categoryValue);
    const byName = catByName.get(categoryValue);
    const matched = byId ?? byName ?? null;

    if (!categoryValue) summary.productsByCategoryRef.empty += 1;
    else if (byId) summary.productsByCategoryRef.id += 1;
    else if (byName) summary.productsByCategoryRef.name += 1;
    else summary.productsByCategoryRef.unmatched += 1;
    if (matched?.parentId) summary.productsByCategoryRef.subcategory += 1;
    if (Array.isArray(product.tags) && product.tags.length) summary.productsWithTags += 1;
    if (String(product.context ?? "").trim()) summary.productsWithContext += 1;

    const suggestedCategoryName = suggestCategory(product.name);
    const suggestedCategory = suggestedCategoryName ? catByName.get(suggestedCategoryName) : null;
    const suggestedSubcategoryName = suggestedCategoryName === "Herramientas e insumos" ? suggestToolSubcategory(product.name) : null;
    const suggestedSubcategory = suggestedSubcategoryName ? catByName.get(suggestedSubcategoryName) : null;
    const inferred = inferTagsAndContext(product);

    if (!matched || (suggestedCategory && matched.name !== suggestedCategory.name && !matched.parentId)) {
      categoryIssues.push({
        sku: product.sku,
        name: product.name,
        currentCategory: categoryValue,
        currentCategoryName: matched?.name ?? null,
        suggestedCategoryName,
        suggestedCategoryId: suggestedCategory ? String(suggestedCategory._id) : null,
        suggestedSubcategoryName,
        suggestedSubcategoryId: suggestedSubcategory ? String(suggestedSubcategory._id) : null,
      });
    }

    if (suggestedCategory || inferred.tags.length || inferred.context) {
      suggestedUpdates.push({
        sku: product.sku,
        name: product.name,
        currentCategory: categoryValue,
        currentCategoryName: matched?.name ?? null,
        suggestedCategoryName,
        suggestedCategoryId: suggestedCategory ? String(suggestedCategory._id) : null,
        suggestedSubcategoryName,
        suggestedSubcategoryId: suggestedSubcategory ? String(suggestedSubcategory._id) : null,
        suggestedTags: inferred.tags,
        suggestedContext: inferred.context,
      });
    }
  }

  const report = {
    summary,
    topCategoryIssues: categoryIssues.slice(0, 300),
    suggestedUpdates: suggestedUpdates.slice(0, 600),
    notes: [
      "No se modifico MongoDB. Es un reporte de lectura.",
      "La base mezcla stock.category como _id, nombre, strings viejos y vacios.",
      "No hay productos ligados a subcategorias actualmente.",
      "Antes de aplicar cambios conviene revisar sugerencias y aprobar por lote.",
    ],
  };

  const outDir = path.join(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "alta-catalog-normalization-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const csvPath = path.join(outDir, "alta-catalog-normalization-suggestions.csv");
  const header = ["sku", "name", "currentCategoryName", "suggestedCategoryName", "suggestedSubcategoryName", "suggestedTags", "suggestedContext"];
  const rows = suggestedUpdates.slice(0, 600).map((row) => header.map((key) => {
    const value = Array.isArray(row[key]) ? row[key].join("|") : String(row[key] ?? "");
    return `"${value.replace(/"/g, '""')}"`;
  }).join(","));
  fs.writeFileSync(csvPath, [header.join(","), ...rows].join("\n"));

  console.log(JSON.stringify({
    summary,
    report: jsonPath,
    csv: csvPath,
    categoryIssues: categoryIssues.length,
    suggestions: suggestedUpdates.length,
  }, null, 2));

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
