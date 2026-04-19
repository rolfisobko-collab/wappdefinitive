"use client";

import { Cart, Product } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { ShoppingCart, Plus, Trash2, Send, X, Package } from "lucide-react";

interface CartPanelProps {
  cart: Cart | null;
  products: Product[];
  conversationId: string;
  onAddProduct: (productId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onSendCart: () => void;
  onClose: () => void;
}

export function CartPanel({ cart, products, onAddProduct, onRemoveItem, onSendCart, onClose }: CartPanelProps) {
  const items = cart?.items ?? [];
  const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  return (
    <div className="flex flex-col h-full bg-white border-l border-[#e9edef] w-72 flex-shrink-0">
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
        <button onClick={onClose} className="p-1 text-[#667781] hover:text-[#111b21] rounded transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Items */}
        {items.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] text-[#667781] font-semibold uppercase tracking-wider">En el carrito</p>
            {items.map((item) => (
              <div key={item.id} className="bg-[#f0f2f5] rounded-xl p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#111b21] truncate">{item.product.name}</p>
                  <p className="text-[11px] text-[#667781]">
                    {formatCurrency(item.unitPrice, item.product.currency)} × {item.quantity}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#008069]">
                    {formatCurrency(item.unitPrice * item.quantity, item.product.currency)}
                  </span>
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    className="p-1 text-[#667781] hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between pt-2 border-t border-[#e9edef]">
              <span className="text-sm font-bold text-[#111b21]">Total</span>
              <span className="text-base font-bold text-[#008069]">{formatCurrency(total, "ARS")}</span>
            </div>

            <button
              onClick={onSendCart}
              className="w-full flex items-center justify-center gap-2 bg-[#008069] hover:bg-[#017561] text-white rounded-xl py-2.5 text-sm font-bold transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" />
              Enviar al cliente
            </button>
          </div>
        ) : (
          <div className="text-center py-8 text-[#667781]">
            <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-25" />
            <p className="text-sm font-medium">Carrito vacío</p>
            <p className="text-xs mt-1 text-[#aebac1]">Agregá productos abajo</p>
          </div>
        )}

        {/* Product list */}
        <div className="space-y-2">
          <p className="text-[11px] text-[#667781] font-semibold uppercase tracking-wider">Agregar productos</p>
          {products.filter((p) => p.active && p.stock > 0).length === 0 ? (
            <div className="text-center py-4 text-[#aebac1]">
              <Package className="w-8 h-8 mx-auto mb-1 opacity-30" />
              <p className="text-xs">Sin productos disponibles</p>
            </div>
          ) : (
            products.filter((p) => p.active && p.stock > 0).map((p) => (
              <div key={p.id} className="bg-[#f0f2f5] rounded-xl p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#111b21] truncate">{p.name}</p>
                  <p className="text-xs font-bold text-[#008069] mt-0.5">{formatCurrency(p.price, p.currency)}</p>
                </div>
                <button
                  onClick={() => onAddProduct(p.id)}
                  className="w-7 h-7 bg-[#008069] hover:bg-[#017561] text-white rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
