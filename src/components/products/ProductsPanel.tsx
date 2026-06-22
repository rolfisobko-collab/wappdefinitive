"use client";

import { useEffect, useState, useCallback } from "react";
import { MongoProduct } from "@/lib/mongodb";
import { Search, Package, RefreshCw, Tag, CheckCircle, XCircle, Zap, ShoppingBag, Filter, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

interface Category { id: string; name: string; icon?: string }

interface ProductsData {
  products: MongoProduct[];
  categories: Category[];
  usdToArs: number;
}

function formatARS(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

const COLOR_OPTIONS = [
  "", "blanco", "negro", "rojo", "azul", "celeste", "rosa", "dorado",
  "lila", "verde", "gris", "amarillo", "naranja", "plateado", "grafito", "beige",
];

function colorLabel(color?: string | null) {
  return color ? color.charAt(0).toUpperCase() + color.slice(1) : "Sin color";
}

export function ProductsPanel() {
  const { toast } = useToast();
  const [data, setData]               = useState<ProductsData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [onlyAvail, setOnlyAvail]     = useState(false);
  const [expanded, setExpanded]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)       params.set("search",     search);
      if (selectedCat)  params.set("categoryId", selectedCat);
      if (onlyAvail)    params.set("available",  "true");
      const res = await fetch(`/api/mongo-products?${params}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast("Error al cargar productos", "error");
    } finally {
      setLoading(false);
    }
  }, [search, selectedCat, onlyAvail]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load]);

  const products = data?.products ?? [];
  const categories = data?.categories ?? [];
  const available = products.filter((p) => p.available).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#f0f2f5]">
      {/* Header */}
      <div className="bg-white border-b border-[#e9edef] px-5 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#008069] rounded-xl flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111b21]">Catálogo de Productos</h2>
              <p className="text-xs text-[#667781]">Sincronizado desde tu base de datos</p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 hover:bg-[#f0f2f5] rounded-lg transition-colors text-[#667781] disabled:opacity-40"
            title="Recargar"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>

        {/* Stats row */}
        {data && (
          <div className="flex gap-3 mb-3 text-xs">
            <div className="flex items-center gap-1.5 bg-[#f0f2f5] rounded-lg px-3 py-1.5">
              <Package className="w-3.5 h-3.5 text-[#667781]" />
              <span className="text-[#111b21] font-semibold">{products.length}</span>
              <span className="text-[#667781]">productos</span>
            </div>
            <div className="flex items-center gap-1.5 bg-green-50 rounded-lg px-3 py-1.5 border border-green-100">
              <CheckCircle className="w-3.5 h-3.5 text-[#008069]" />
              <span className="text-[#008069] font-semibold">{available}</span>
              <span className="text-[#667781]">disponibles</span>
            </div>
            <div className="flex items-center gap-1.5 bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-100">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-amber-700 font-semibold">Precios en pesos</span>
            </div>
          </div>
        )}

        {/* Search + filters */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aebac1]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar productos..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#f0f2f5] border border-transparent text-sm text-[#111b21] placeholder-[#aebac1] outline-none focus:border-[#008069] focus:bg-white transition-colors"
            />
          </div>
          <button
            onClick={() => setOnlyAvail(!onlyAvail)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all",
              onlyAvail
                ? "bg-[#008069] text-white border-[#008069]"
                : "bg-[#f0f2f5] text-[#667781] border-transparent hover:border-[#e9edef]"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Con stock
          </button>
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto flex-shrink-0 bg-white border-b border-[#e9edef] scrollbar-thin">
          <button
            onClick={() => setSelectedCat("")}
            className={cn(
              "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
              selectedCat === ""
                ? "bg-[#008069] text-white border-[#008069]"
                : "bg-[#f0f2f5] text-[#667781] border-transparent hover:bg-[#e9edef]"
            )}
          >
            Todos
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCat(selectedCat === cat.id ? "" : cat.id)}
              className={cn(
                "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap",
                selectedCat === cat.id
                  ? "bg-[#008069] text-white border-[#008069]"
                  : "bg-[#f0f2f5] text-[#667781] border-transparent hover:bg-[#e9edef]"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Products grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#e9edef] p-4 animate-pulse">
                <div className="w-full h-36 bg-[#f0f2f5] rounded-xl mb-3" />
                <div className="h-4 bg-[#f0f2f5] rounded-full w-3/4 mb-2" />
                <div className="h-3 bg-[#f0f2f5] rounded-full w-1/2" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#667781]">
            <Package className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">No se encontraron productos</p>
            {search && (
              <button onClick={() => setSearch("")} className="mt-2 text-[#008069] text-xs hover:underline">
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                expanded={expanded === product.id}
                onToggle={() => setExpanded(expanded === product.id ? null : product.id)}
                onSaved={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ product, expanded, onToggle }: {
  product: MongoProduct;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const hasPromo = !!product.promoPriceARS && product.promoPriceARS < product.priceARS;
  const [savingColor, setSavingColor] = useState(false);
  const { toast } = useToast();

  async function saveColor(color: string) {
    setSavingColor(true);
    try {
      const res = await fetch(`/api/mongo-products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) throw new Error();
      onSaved();
      toast("Color actualizado", "success");
    } catch {
      toast("No se pudo guardar el color", "error");
    } finally {
      setSavingColor(false);
    }
  }

  return (
    <div
      className={cn(
        "bg-white rounded-2xl border transition-all duration-200 overflow-hidden cursor-pointer hover:shadow-md",
        product.available ? "border-[#e9edef]" : "border-[#e9edef] opacity-70"
      )}
      onClick={onToggle}
    >
      {/* Image */}
      <div className="relative w-full h-36 bg-[#f0f2f5]">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-10 h-10 text-[#aebac1]" />
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
          {product.weeklyOffer && (
            <span className="bg-[#7c4dff] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              OFERTA
            </span>
          )}
          {product.liquidation && (
            <span className="bg-[#f59e0b] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              LIQUI
            </span>
          )}
          {product.color && (
            <span className="bg-white/90 text-[#111b21] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#e9edef]">
              {colorLabel(product.color)}
            </span>
          )}
        </div>

        {/* Stock badge */}
        <div className="absolute top-2 right-2">
          {product.available ? (
            <span className="flex items-center gap-1 bg-white/90 text-[#008069] text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-200">
              <CheckCircle className="w-2.5 h-2.5" />
              Disponible
            </span>
          ) : (
            <span className="flex items-center gap-1 bg-white/90 text-red-500 text-[10px] font-bold px-2 py-0.5 rounded-full border border-red-100">
              <XCircle className="w-2.5 h-2.5" />
              Sin stock
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        {product.category && (
          <div className="flex items-center gap-1 mb-1">
            <Tag className="w-2.5 h-2.5 text-[#aebac1]" />
            <span className="text-[10px] text-[#aebac1] uppercase tracking-wide font-semibold">
              {product.category}
            </span>
          </div>
        )}

        <h3 className="text-sm font-semibold text-[#111b21] line-clamp-2 leading-snug mb-2">
          {product.name}
        </h3>

        {/* Prices */}
        <div className="flex flex-col gap-0.5">
          {hasPromo ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-[#008069]">
                  {formatARS(product.promoPriceARS!)}
                </span>
                <span className="text-xs text-[#aebac1] line-through">{formatARS(product.priceARS)}</span>
              </div>
              <span className="text-xs text-[#667781]">{formatARS(product.promoPriceARS!)}</span>
            </>
          ) : (
            <>
              <span className="text-base font-bold text-[#111b21]">{formatARS(product.priceARS)}</span>
            </>
          )}
        </div>

        {/* Expanded: description + SKU */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-[#f0f2f5] space-y-1.5">
            {product.description && (
              <p className="text-xs text-[#667781] leading-relaxed">{product.description}</p>
            )}
            <div className="flex gap-3 flex-wrap">
              {product.sku && (
                <span className="text-[10px] text-[#aebac1] bg-[#f0f2f5] px-2 py-0.5 rounded-full">
                  SKU: {product.sku}
                </span>
              )}
              {product.location && (
                <span className="text-[10px] text-[#aebac1] bg-[#f0f2f5] px-2 py-0.5 rounded-full">
                  📍 {product.location}
                </span>
              )}
              {product.color && (
                <span className="text-[10px] text-[#008069] bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                  Color: {colorLabel(product.color)}
                </span>
              )}
            </div>
            <div className="pt-2">
              <label className="flex items-center gap-1 text-[10px] text-[#667781] font-semibold mb-1">
                <Palette className="w-3 h-3" />
                Color del producto
              </label>
              <select
                value={product.color ?? ""}
                disabled={savingColor}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => saveColor(event.target.value)}
                className="w-full rounded-lg bg-[#f0f2f5] border border-transparent px-2 py-1.5 text-xs text-[#111b21] outline-none focus:border-[#008069] focus:bg-white"
              >
                {COLOR_OPTIONS.map((color) => (
                  <option key={color || "none"} value={color}>
                    {colorLabel(color)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
