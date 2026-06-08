"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  Bike, CheckCircle2, Clock, CreditCard, MapPin, PackageCheck, RefreshCw,
  Search, Store, Truck, WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

type DeliveryType = "pickup" | "delivery";

type OrderItem = {
  productId?: string;
  name: string;
  price: number;
  quantity: number;
  image?: string | null;
};

type Order = {
  id: string;
  customer: string;
  phone: string;
  email: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentMethodName: string;
  deliveryType: DeliveryType;
  deliveryStatus: string;
  shippingAddress: string | Record<string, unknown> | null;
  shippingProvider: string | null;
  trackingUrl: string | null;
  shippingId: string | null;
  items: OrderItem[];
  subtotalUSD: number;
  shippingUSD: number;
  totalUSD: number;
  subtotalARS: number;
  shippingARS: number;
  totalARS: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type OrdersResponse = { orders: Order[]; usdToArs: number };

const orderStatuses = [
  { id: "pending", label: "Nuevo" },
  { id: "preparing", label: "Preparando" },
  { id: "ready", label: "Listo" },
  { id: "shipped", label: "Enviado" },
  { id: "delivered", label: "Entregado" },
  { id: "cancelled", label: "Cancelado" },
];

const paymentStatuses = [
  { id: "pending", label: "Pendiente" },
  { id: "approved", label: "Pagado" },
  { id: "paid", label: "Pagado" },
  { id: "rejected", label: "Rechazado" },
  { id: "refunded", label: "Devuelto" },
];

const deliveryStatuses = [
  { id: "pickup_pending", label: "Retiro pendiente" },
  { id: "not_quoted", label: "Sin cotizar" },
  { id: "quoted", label: "Cotizado" },
  { id: "ready_for_pickup", label: "Listo para retiro" },
  { id: "courier_requested", label: "Envío pedido" },
  { id: "in_transit", label: "En camino" },
  { id: "delivered", label: "Entregado" },
];

function fARS(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

function statusLabel(list: { id: string; label: string }[], value: string) {
  return list.find((s) => s.id === value)?.label ?? value;
}

function paymentTone(status: string) {
  if (status === "approved" || status === "paid") return "bg-green-50 text-[#008069] border-green-100";
  if (status === "rejected" || status === "refunded") return "bg-red-50 text-red-600 border-red-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

function orderTone(status: string) {
  if (status === "delivered") return "bg-green-50 text-[#008069] border-green-100";
  if (status === "cancelled") return "bg-red-50 text-red-600 border-red-100";
  if (status === "ready" || status === "shipped") return "bg-blue-50 text-blue-700 border-blue-100";
  return "bg-[#f0f2f5] text-[#54656f] border-[#e9edef]";
}

function addressText(address: Order["shippingAddress"]) {
  if (!address) return "Sin dirección";
  if (typeof address === "string") return address;
  return Object.entries(address)
    .filter(([, value]) => value)
    .map(([, value]) => String(value))
    .join(", ") || "Sin dirección";
}

export function OrdersPanel() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [usdToArs, setUsdToArs] = useState(1530);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await fetch("/api/orders?limit=120");
      if (!res.ok) throw new Error();
      const data: OrdersResponse = await res.json();
      setOrders(data.orders);
      setUsdToArs(data.usdToArs);
      setSelectedId((current) => current ?? data.orders[0]?.id ?? null);
    } catch {
      toast("Error al cargar pedidos", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadOrders(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesQuery = !q
        || order.customer.toLowerCase().includes(q)
        || order.phone.includes(q)
        || order.id.toLowerCase().includes(q)
        || order.items.some((item) => item.name.toLowerCase().includes(q));
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && !["delivered", "cancelled"].includes(order.status)) ||
        (filter === "paid" && ["approved", "paid"].includes(order.paymentStatus)) ||
        (filter === "pending_payment" && !["approved", "paid"].includes(order.paymentStatus)) ||
        (filter === "delivery" && order.deliveryType === "delivery") ||
        (filter === "pickup" && order.deliveryType === "pickup");
      return matchesQuery && matchesFilter;
    });
  }, [orders, query, filter]);

  const selected = orders.find((order) => order.id === selectedId) ?? filtered[0] ?? null;

  const stats = useMemo(() => {
    const active = orders.filter((o) => !["delivered", "cancelled"].includes(o.status)).length;
    const paid = orders.filter((o) => ["approved", "paid"].includes(o.paymentStatus)).length;
    const delivery = orders.filter((o) => o.deliveryType === "delivery").length;
    const pickup = orders.filter((o) => o.deliveryType === "pickup").length;
    return { active, paid, delivery, pickup };
  }, [orders]);

  async function patchOrder(id: string, update: Partial<Order>) {
    setSaving(id);
    const previous = orders;
    setOrders((current) => current.map((order) => order.id === id ? { ...order, ...update } : order));
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...update }),
      });
      if (!res.ok) throw new Error();
      toast("Pedido actualizado", "success");
    } catch {
      setOrders(previous);
      toast("No se pudo actualizar el pedido", "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex-1 min-w-0 bg-[#f0f2f5] overflow-hidden flex flex-col">
      <div className="bg-white border-b border-[#e9edef] px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#111b21]">Pedidos</h2>
            <p className="text-xs text-[#667781]">Despacho, pagos, retiro en local y envíos</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-[#667781] bg-[#f0f2f5] px-3 py-2 rounded-lg">
              Cotización interna: {fARS(usdToArs)}
            </span>
            <button
              onClick={loadOrders}
              disabled={loading}
              className="h-9 px-3 rounded-lg bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] transition-colors flex items-center gap-2 text-sm font-semibold disabled:opacity-50"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              Recargar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
          <Stat icon={Clock} label="Activos" value={stats.active} />
          <Stat icon={WalletCards} label="Pagados" value={stats.paid} />
          <Stat icon={Truck} label="Envíos" value={stats.delivery} />
          <Stat icon={Store} label="Retiro local" value={stats.pickup} />
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aebac1]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente, teléfono, producto o pedido"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#f0f2f5] border border-transparent text-sm text-[#111b21] outline-none focus:border-[#008069] focus:bg-white transition-colors"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {[
              ["active", "Activos"],
              ["pending_payment", "Sin pagar"],
              ["paid", "Pagados"],
              ["delivery", "Envío"],
              ["pickup", "Retiro"],
              ["all", "Todos"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={cn(
                  "flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-colors",
                  filter === id ? "bg-[#008069] text-white" : "bg-[#f0f2f5] text-[#667781] hover:bg-[#e9edef]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-[#e9edef] bg-white">
          {loading && orders.length === 0 ? (
            <div className="h-40 flex items-center justify-center">
              <div className="w-7 h-7 border-2 border-[#008069] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-[#667781] gap-2">
              <PackageCheck className="w-9 h-9 opacity-30" />
              <p className="text-sm">Sin pedidos para este filtro</p>
            </div>
          ) : (
            filtered.map((order) => (
              <button
                key={order.id}
                onClick={() => setSelectedId(order.id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-[#f0f2f5] hover:bg-[#f7f8f8] transition-colors",
                  selected?.id === order.id && "bg-[#e7fce3] hover:bg-[#e7fce3]"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111b21] truncate">{order.customer}</p>
                    <p className="text-xs text-[#667781] truncate">{order.phone || "Sin teléfono"}</p>
                  </div>
                  <p className="text-sm font-bold text-[#008069] flex-shrink-0">{fARS(order.totalARS)}</p>
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Chip className={paymentTone(order.paymentStatus)}>{statusLabel(paymentStatuses, order.paymentStatus)}</Chip>
                  <Chip className={orderTone(order.status)}>{statusLabel(orderStatuses, order.status)}</Chip>
                  <Chip className="bg-[#f0f2f5] text-[#54656f] border-[#e9edef]">
                    {order.deliveryType === "pickup" ? "Retiro local" : "Envío"}
                  </Chip>
                </div>
                <p className="text-[11px] text-[#aebac1] mt-2 truncate">
                  {order.items.map((item) => `${item.quantity}x ${item.name}`).join(" · ")}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {selected ? (
            <OrderDetail
              order={selected}
              saving={saving === selected.id}
              onPatch={(update) => patchOrder(selected.id, update)}
            />
          ) : (
            <div className="h-full min-h-[320px] flex items-center justify-center text-[#667781]">
              Seleccioná un pedido
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="bg-[#f0f2f5] rounded-lg px-3 py-2 flex items-center gap-2">
      <Icon className="w-4 h-4 text-[#008069]" />
      <div>
        <p className="text-sm font-bold text-[#111b21] leading-none">{value}</p>
        <p className="text-[11px] text-[#667781] mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", className)}>{children}</span>;
}

function OrderDetail({ order, saving, onPatch }: {
  order: Order;
  saving: boolean;
  onPatch: (update: Partial<Order>) => void;
}) {
  const paid = order.paymentStatus === "approved" || order.paymentStatus === "paid";
  const lineRate = order.subtotalUSD > 0 ? order.subtotalARS / order.subtotalUSD : 1530;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="bg-white border border-[#e9edef] rounded-xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs text-[#667781] font-semibold">Pedido #{order.id.slice(-8).toUpperCase()}</p>
            <h3 className="text-xl font-bold text-[#111b21] mt-1">{order.customer}</h3>
            <p className="text-sm text-[#667781] mt-1">{order.phone || order.email || "Sin contacto"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip className={paymentTone(order.paymentStatus)}>
              {paid ? <CheckCircle2 className="inline w-3 h-3 mr-1" /> : <Clock className="inline w-3 h-3 mr-1" />}
              {statusLabel(paymentStatuses, order.paymentStatus)}
            </Chip>
            <Chip className={orderTone(order.status)}>{statusLabel(orderStatuses, order.status)}</Chip>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <SelectBlock
            label="Estado del pedido"
            value={order.status}
            options={orderStatuses}
            disabled={saving}
            onChange={(status) => onPatch({ status })}
          />
          <SelectBlock
            label="Pago"
            value={order.paymentStatus}
            options={paymentStatuses}
            disabled={saving}
            onChange={(paymentStatus) => onPatch({ paymentStatus })}
          />
          <SelectBlock
            label="Entrega"
            value={order.deliveryType}
            options={[{ id: "pickup", label: "Retiro local" }, { id: "delivery", label: "Envío" }]}
            disabled={saving}
            onChange={(deliveryType) => onPatch({
              deliveryType: deliveryType as DeliveryType,
              deliveryStatus: deliveryType === "pickup" ? "pickup_pending" : "not_quoted",
            })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="bg-white border border-[#e9edef] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0f2f5] flex items-center justify-between">
            <h4 className="text-sm font-bold text-[#111b21]">Productos</h4>
            <span className="text-xs text-[#667781]">{order.items.length} ítems</span>
          </div>
          <div className="divide-y divide-[#f0f2f5]">
            {order.items.map((item, index) => (
              <div key={`${item.productId ?? item.name}-${index}`} className="p-3 flex gap-3">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-14 h-14 rounded-lg object-cover bg-[#f0f2f5]" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-[#f0f2f5] flex items-center justify-center">
                    <PackageCheck className="w-6 h-6 text-[#aebac1]" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#111b21] line-clamp-2">{item.name}</p>
                  <p className="text-xs text-[#667781] mt-1">Cantidad: {item.quantity}</p>
                </div>
                <p className="text-sm font-bold text-[#111b21]">{fARS(Math.round(item.price * item.quantity * lineRate))}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-[#e9edef] rounded-xl p-4">
            <h4 className="text-sm font-bold text-[#111b21] mb-3">Totales</h4>
            <Line label="Productos" value={fARS(order.subtotalARS)} />
            <Line label="Envío" value={order.shippingARS > 0 ? fARS(order.shippingARS) : "Sin cotizar"} />
            <div className="border-t border-[#f0f2f5] pt-3 mt-3 flex justify-between">
              <span className="text-sm font-bold text-[#111b21]">Total</span>
              <span className="text-lg font-bold text-[#008069]">{fARS(order.totalARS)}</span>
            </div>
          </div>

          <div className="bg-white border border-[#e9edef] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              {order.deliveryType === "pickup" ? <Store className="w-4 h-4 text-[#008069]" /> : <Bike className="w-4 h-4 text-[#008069]" />}
              <h4 className="text-sm font-bold text-[#111b21]">{order.deliveryType === "pickup" ? "Retiro en local" : "Envío"}</h4>
            </div>
            <div className="flex items-start gap-2 text-xs text-[#667781] mb-3">
              <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{addressText(order.shippingAddress)}</span>
            </div>
            <SelectBlock
              label="Estado de entrega"
              value={order.deliveryStatus}
              options={deliveryStatuses}
              disabled={saving}
              onChange={(deliveryStatus) => onPatch({ deliveryStatus })}
            />
            <div className="grid grid-cols-1 gap-2 mt-3">
              <button
                disabled={saving || order.deliveryType !== "delivery"}
                onClick={() => onPatch({ deliveryStatus: "quoted", shippingProvider: "pedidosya" })}
                className="h-9 rounded-lg bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] disabled:opacity-40 disabled:hover:bg-[#f0f2f5] transition-colors text-xs font-bold"
              >
                Cotizar PedidosYa
              </button>
              <button
                disabled={saving || order.deliveryType !== "delivery" || !paid}
                onClick={() => onPatch({ deliveryStatus: "courier_requested", shippingProvider: "pedidosya" })}
                className="h-9 rounded-lg bg-[#008069] text-white hover:bg-[#017561] disabled:opacity-40 disabled:hover:bg-[#008069] transition-colors text-xs font-bold"
              >
                Crear envío
              </button>
              <button
                disabled={saving}
                onClick={() => onPatch({ status: "ready", deliveryStatus: order.deliveryType === "pickup" ? "ready_for_pickup" : order.deliveryStatus })}
                className="h-9 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-xs font-bold disabled:opacity-40"
              >
                Marcar listo
              </button>
            </div>
            <p className="text-[11px] text-[#aebac1] mt-3">
              PedidosYa queda preparado para conectar API; por ahora registra el estado operativo.
            </p>
          </div>

          <div className="bg-white border border-[#e9edef] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="w-4 h-4 text-[#008069]" />
              <h4 className="text-sm font-bold text-[#111b21]">Pago</h4>
            </div>
            <Line label="Método" value={order.paymentMethodName || order.paymentMethod} />
            <Line label="Estado" value={statusLabel(paymentStatuses, order.paymentStatus)} />
            {!paid && (
              <button
                disabled={saving}
                onClick={() => onPatch({ paymentStatus: "approved" })}
                className="w-full h-9 mt-3 rounded-lg bg-[#008069] text-white hover:bg-[#017561] transition-colors text-xs font-bold disabled:opacity-40"
              >
                Marcar pagado
              </button>
            )}
            {paid && (
              <button
                disabled={saving}
                onClick={() => onPatch({ paymentStatus: "pending" })}
                className="w-full h-9 mt-3 rounded-lg bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] transition-colors text-xs font-bold disabled:opacity-40"
              >
                Volver a pendiente
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectBlock({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-[#667781] font-bold uppercase tracking-wide">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-10 rounded-lg bg-[#f0f2f5] border border-transparent px-3 text-sm text-[#111b21] outline-none focus:border-[#008069] focus:bg-white transition-colors disabled:opacity-50"
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm py-1">
      <span className="text-[#667781]">{label}</span>
      <span className="font-semibold text-[#111b21] text-right">{value}</span>
    </div>
  );
}
