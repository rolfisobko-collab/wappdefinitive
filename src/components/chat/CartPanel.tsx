"use client";

import { useEffect, useState, useCallback } from "react";
import { CartMongoItem } from "@/lib/db";
import { MongoProduct } from "@/lib/mongodb";
import { ShoppingCart, Trash2, Send, X, Package, Search, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface CartData {
  id: string;
  items: CartMongoItem[];
}

interface CartPanelProps {
  cart: CartData | null;
  conversationId: string;
  onCartChange: (cart: CartData | null) => void;
  onSendCart: () => void;
  onClose: () => void;
}

function fARS(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}
function fUSD(n: number) {
  return `USD ${n.toFixed(0)}`;
}

export function CartPanel({ cart, conversationId, onCartChange, onSendCart, onClose }: CartPanelProps) {
  const items = cart?.items ?? [];
  const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
  const totalARS = items.reduce((s, i) => s + i.unitPriceARS * i.quantity, 0);

  const [search, setSearch]       = useState("");
  const [results, setResults]     = useState<MongoProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding]       = useState<string | null>(null);
  const [removing, setRemoving]   = useState<string | null>(null);

  const searchProducts = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/mongo-products?search=${encodeURIComponent(q)}&available=true`);
      const data = await res.json();
      setResults(data.products?.slice(0, 8) ?? []);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchProducts(search), 400);
    return () => clearTimeout(t);
  }, [search, searchProducts]);

  async function addItem(product: MongoProduct) {
    setAdding(product.id);
    try {
      const res = await fetch(`/api/cart/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mongoProductId: product.id,
          name: product.name,
          image: product.image,
          unitPriceUSD: product.promoPrice ?? product.price,
          unitPriceARS: product.promoPriceARS ?? product.priceARS,
          quantity: 1,
        }),
      });
      if (res.ok) onCartChange(await res.json());
    } finally { setAdding(null); }
  }

  async function removeItem(itemId: string) {
    setRemoving(itemId);
    try {
      const res = await fetch(`/api/cart/${conversationId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (res.ok) onCartChange(await res.json());
    } finally { setRemoving(null); }
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-[#e9edef] w-80 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#f0f2f5] border-b border-[#e9edef]">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-[#008069]" />
          <h3 className="font-semibold text-sm text-[#111b21]">Carrito</h3>
          {items.length > 0 && (
            <span className="bg-[#008069] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {items.reduce((s, i) => s + i.quantity, 0)}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 text-[#667781] hover:text-[#111b21] transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Cart items ── */}
        <div className="p-3 space-y-2">
          {items.length > 0 ? (
            <>
              <p className="text-[10px] text-[#667781] font-bold uppercase tracking-wider px-1">En el carrito</p>
              {items.map((item) => (
                <div key={item.id} className="bg-[#f0f2f5] rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 p-2.5">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                        <Package className="w-5 h-5 text-[#aebac1]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#111b21] line-clamp-2 leading-snug">{item.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] font-bold text-[#008069]">{fUSD(item.unitPriceUSD)}</span>
                        <span className="text-[10px] text-[#aebac1]">·</span>
                        <span className="text-[10px] text-[#667781]">{fARS(item.unitPriceARS)}</span>
                        <span className="text-[10px] text-[#aebac1]">× {item.quantity}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      disabled={removing === item.id}
                      className="p-1.5 text-[#aebac1] hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Total */}
              <div className="bg-[#f0f2f5] rounded-xl p-3 mt-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-[#111b21]">Total</span>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#111b21]">{fUSD(totalUSD)}</p>
                    <p className="text-xs text-[#667781]">{fARS(totalARS)}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={onSendCart}
                className="w-full flex items-center justify-center gap-2 bg-[#008069] hover:bg-[#017561] text-white rounded-xl py-2.5 text-sm font-bold transition-colors shadow-sm"
              >
                <Send className="w-4 h-4" />
                Enviar al cliente
              </button>
            </>
          ) : (
            <div className="text-center py-6 text-[#667781]">
              <ShoppingCart className="w-9 h-9 mx-auto mb-2 opacity-25" />
              <p className="text-sm font-medium">Carrito vacío</p>
              <p className="text-xs mt-1 text-[#aebac1]">Buscá un producto abajo</p>
            </div>
          )}
        </div>

        {/* ── Product search ── */}
        <div className="border-t border-[#e9edef] p-3 space-y-2">
          <p className="text-[10px] text-[#667781] font-bold uppercase tracking-wider px-1">Agregar producto</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#aebac1]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre..."
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#f0f2f5] border border-transparent text-xs text-[#111b21] placeholder-[#aebac1] outline-none focus:border-[#008069] focus:bg-white transition-colors"
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border border-[#008069] border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {results.length > 0 && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {results.map((p) => {
                const inCart = items.some((i) => i.mongoProductId === p.id);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-xl border transition-colors",
                      inCart ? "bg-green-50 border-green-200" : "bg-[#f0f2f5] border-transparent"
                    )}
                  >
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                        <Package className="w-4 h-4 text-[#aebac1]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-[#111b21] line-clamp-1">{p.name}</p>
                      <p className="text-[10px] text-[#667781]">{fUSD(p.promoPrice ?? p.price)} · {fARS(p.promoPriceARS ?? p.priceARS)}</p>
                    </div>
                    <button
                      onClick={() => addItem(p)}
                      disabled={adding === p.id}
                      className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                        inCart
                          ? "bg-green-100 text-[#008069] hover:bg-green-200"
                          : "bg-[#008069] text-white hover:bg-[#017561]"
                      )}
                    >
                      {adding === p.id
                        ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        : inCart ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {search.length > 0 && !searching && results.length === 0 && (
            <p className="text-xs text-[#aebac1] text-center py-2">Sin resultados para "{search}"</p>
          )}
        </div>
      </div>
    </div>
  );
}
