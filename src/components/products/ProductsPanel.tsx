"use client";

import { useEffect, useState } from "react";
import { Product } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2, Package, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

export function ProductsPanel() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    currency: "ARS",
    category: "",
    sku: "",
    stock: "",
    imageUrl: "",
  });

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      setProducts(data);
    } catch {
      toast("Error al cargar productos", "error");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingProduct(null);
    setForm({ name: "", description: "", price: "", currency: "ARS", category: "", sku: "", stock: "", imageUrl: "" });
    setShowForm(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setForm({
      name: product.name,
      description: product.description ?? "",
      price: String(product.price),
      currency: product.currency,
      category: product.category ?? "",
      sku: product.sku ?? "",
      stock: String(product.stock),
      imageUrl: product.imageUrl ?? "",
    });
    setShowForm(true);
  }

  async function saveProduct() {
    if (!form.name || !form.price) {
      toast("Nombre y precio son requeridos", "error");
      return;
    }
    try {
      const url = editingProduct ? `/api/products/${editingProduct.id}` : "/api/products";
      const method = editingProduct ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      await loadProducts();
      setShowForm(false);
      toast(editingProduct ? "Producto actualizado" : "Producto creado", "success");
    } catch {
      toast("Error al guardar producto", "error");
    }
  }

  async function toggleActive(product: Product) {
    try {
      await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !product.active }),
      });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, active: !p.active } : p)));
    } catch {
      toast("Error al actualizar producto", "error");
    }
  }

  async function deleteProduct(id: string) {
    if (!confirm("¿Eliminar este producto?")) return;
    try {
      await fetch(`/api/products/${id}`, { method: "DELETE" });
      setProducts((prev) => prev.filter((p) => p.id !== id));
      toast("Producto eliminado", "success");
    } catch {
      toast("Error al eliminar producto", "error");
    }
  }

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-[#e9edef]">Catálogo de Productos</h2>
            <p className="text-sm text-[#8696a0] mt-0.5">
              La IA tiene acceso a estos productos para responder a los clientes
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-[#00a884] hover:bg-[#00c795] text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuevo producto
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Total productos", value: products.length, color: "text-[#e9edef]" },
            { label: "Activos", value: products.filter((p) => p.active).length, color: "text-[#00a884]" },
            { label: "Sin stock", value: products.filter((p) => p.stock === 0).length, color: "text-[#ff9800]" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#202c33] rounded-xl p-4 border border-[#2a3942]">
              <p className="text-xs text-[#8696a0] mb-1">{stat.label}</p>
              <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Products grid */}
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#8696a0]">
            <Package className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No hay productos todavía</p>
            <button onClick={openCreate} className="mt-3 text-[#00a884] text-sm hover:underline">
              Agregar el primero
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {categories.length > 0 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {categories.map((cat) => (
                  <span key={cat} className="flex-shrink-0 px-3 py-1 bg-[#2a3942] text-[#8696a0] text-xs rounded-full">
                    {cat}
                  </span>
                ))}
              </div>
            )}

            {products.map((product) => (
              <div
                key={product.id}
                className={cn(
                  "bg-[#202c33] rounded-xl p-4 border transition-colors",
                  product.active ? "border-[#2a3942]" : "border-[#374045] opacity-60"
                )}
              >
                <div className="flex items-start gap-4">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-[#2a3942] flex items-center justify-center flex-shrink-0">
                      <Package className="w-7 h-7 text-[#8696a0]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-[#e9edef] text-sm">{product.name}</h3>
                        {product.category && (
                          <span className="text-xs text-[#8696a0] bg-[#2a3942] px-2 py-0.5 rounded-full">
                            {product.category}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => toggleActive(product)}
                          className="p-1.5 text-[#8696a0] hover:text-[#e9edef] transition-colors"
                          title={product.active ? "Desactivar" : "Activar"}
                        >
                          {product.active ? (
                            <ToggleRight className="w-5 h-5 text-[#00a884]" />
                          ) : (
                            <ToggleLeft className="w-5 h-5" />
                          )}
                        </button>
                        <button
                          onClick={() => openEdit(product)}
                          className="p-1.5 text-[#8696a0] hover:text-[#e9edef] transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteProduct(product.id)}
                          className="p-1.5 text-[#8696a0] hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {product.description && (
                      <p className="text-xs text-[#8696a0] mt-1 line-clamp-2">{product.description}</p>
                    )}

                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-base font-bold text-[#00a884]">
                        {formatCurrency(product.price, product.currency)}
                      </span>
                      <span className={cn("text-xs font-medium", product.stock > 0 ? "text-[#8696a0]" : "text-[#ff9800]")}>
                        {product.stock > 0 ? `Stock: ${product.stock}` : "Sin stock"}
                      </span>
                      {product.sku && (
                        <span className="text-xs text-[#8696a0]">SKU: {product.sku}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#202c33] rounded-2xl w-full max-w-lg shadow-2xl border border-[#2a3942] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[#2a3942]">
              <h3 className="text-[#e9edef] font-semibold">
                {editingProduct ? "Editar producto" : "Nuevo producto"}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-[#8696a0] hover:text-[#e9edef]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {[
                { key: "name", label: "Nombre *", placeholder: "Ej: Remera Oversize", type: "text" },
                { key: "description", label: "Descripción", placeholder: "Descripción del producto...", type: "text" },
                { key: "price", label: "Precio *", placeholder: "8500", type: "number" },
                { key: "category", label: "Categoría", placeholder: "Ej: Ropa", type: "text" },
                { key: "sku", label: "SKU", placeholder: "Ej: REM-001", type: "text" },
                { key: "stock", label: "Stock", placeholder: "0", type: "number" },
                { key: "imageUrl", label: "URL de imagen", placeholder: "https://...", type: "url" },
              ].map((field) => (
                <div key={field.key}>
                  <label className="text-xs text-[#8696a0] mb-1 block">{field.label}</label>
                  <input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={form[field.key as keyof typeof form]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="w-full bg-[#2a3942] text-[#e9edef] rounded-lg px-3 py-2.5 text-sm outline-none placeholder-[#8696a0] focus:ring-1 focus:ring-[#00a884]"
                  />
                </div>
              ))}

              <div>
                <label className="text-xs text-[#8696a0] mb-1 block">Moneda</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                  className="w-full bg-[#2a3942] text-[#e9edef] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-[#00a884]"
                >
                  <option value="ARS">ARS - Peso argentino</option>
                  <option value="USD">USD - Dólar</option>
                  <option value="MXN">MXN - Peso mexicano</option>
                  <option value="BRL">BRL - Real brasileño</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 p-5 border-t border-[#2a3942]">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-lg text-sm text-[#8696a0] bg-[#374045] hover:bg-[#454f57] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveProduct}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-[#00a884] hover:bg-[#00c795] text-white transition-colors"
              >
                {editingProduct ? "Guardar cambios" : "Crear producto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
