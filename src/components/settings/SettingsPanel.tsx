"use client";

import { useEffect, useState } from "react";
import { AIConfig, WAConfig } from "@/lib/types";
import { Bot, Webhook, Save, ChevronDown, ChevronUp, Info, Zap, Key, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

export function SettingsPanel() {
  const { toast } = useToast();
  const [aiConfig, setAiConfig] = useState<AIConfig & { hasGroqKey?: boolean } | null>(null);
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [waConfig, setWaConfig] = useState<Partial<WAConfig>>({});
  const [loading, setLoading]   = useState(true);
  const [savingAI, setSavingAI] = useState(false);
  const [savingWA, setSavingWA] = useState(false);
  const [open, setOpen]         = useState<"ai" | "wa" | "info" | null>("ai");

  useEffect(() => {
    Promise.all([
      fetch("/api/ai-config").then((r) => r.json()),
      fetch("/api/wa-config").then((r) => r.json()),
    ])
      .then(([ai, wa]) => { if (ai) setAiConfig(ai); if (wa) setWaConfig(wa); })
      .catch(() => toast("Error al cargar configuración", "error"))
      .finally(() => setLoading(false));
  }, []);

  async function saveAI() {
    if (!aiConfig) return;
    setSavingAI(true);
    try {
      const payload = {
        ...aiConfig,
        ...(groqKeyInput.trim() ? { groqApiKey: groqKeyInput.trim() } : {}),
      };
      const res = await fetch("/api/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setAiConfig(updated);
      if (groqKeyInput.trim()) setGroqKeyInput("");
      toast("Configuración de IA guardada ✓", "success");
    } catch { toast("Error al guardar", "error"); }
    finally { setSavingAI(false); }
  }

  async function saveWA() {
    setSavingWA(true);
    try {
      const res = await fetch("/api/wa-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(waConfig),
      });
      if (!res.ok) throw new Error();
      toast("WhatsApp configurado ✓", "success");
    } catch { toast("Error al guardar", "error"); }
    finally { setSavingWA(false); }
  }

  const appUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-[#f0f2f5]">
      <div className="w-7 h-7 border-2 border-[#008069] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const SectionBtn = ({ id, icon: Icon, title, subtitle, color }: { id: "ai"|"wa"|"info"; icon: React.ElementType; title: string; subtitle: string; color: string }) => (
    <button
      onClick={() => setOpen(open === id ? null : id)}
      className="w-full flex items-center justify-between p-5 text-left hover:bg-[#f9fafb] transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-sm text-[#111b21]">{title}</p>
          <p className="text-xs text-[#667781]">{subtitle}</p>
        </div>
      </div>
      {open === id ? <ChevronUp className="w-4 h-4 text-[#667781]" /> : <ChevronDown className="w-4 h-4 text-[#667781]" />}
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-[#f0f2f5] p-4 sm:p-6">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-[#111b21]">Configuración</h2>
          <p className="text-sm text-[#667781] mt-0.5">Personalizá el asistente y conectá WhatsApp</p>
        </div>

        {/* ─── IA ─── */}
        <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden shadow-sm">
          <SectionBtn id="ai" icon={Bot} title="Asistente IA" subtitle="Groq Llama 3.3 — Prompt y comportamiento" color="bg-[#7c4dff]" />

          {open === "ai" && aiConfig && (
            <div className="px-5 pb-5 space-y-4 border-t border-[#e9edef] pt-4">
              {/* Model info badge */}
              <div className="flex items-center gap-2 bg-purple-50 rounded-xl px-3 py-2.5 border border-purple-100">
                <Zap className="w-4 h-4 text-[#7c4dff]" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#7c4dff]">Groq — Llama 3.3 70B Versatile</p>
                  <p className="text-[11px] text-purple-400">Gratuito · Ultra rápido · Ideal para ventas en español</p>
                </div>
                {aiConfig?.hasGroqKey
                  ? <span className="flex items-center gap-1 text-[11px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-200"><CheckCircle2 className="w-3 h-3" />Conectada</span>
                  : <span className="text-[11px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-full border border-red-200">Sin key</span>
                }
              </div>

              {/* Groq API Key field */}
              <div>
                <label className="text-xs text-[#667781] mb-1.5 block font-semibold flex items-center gap-1.5">
                  <Key className="w-3 h-3" />
                  Groq API Key
                  <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-[#7c4dff] hover:underline font-normal ml-1">
                    (console.groq.com)
                  </a>
                </label>
                <div className="relative">
                  <input
                    type={showGroqKey ? "text" : "password"}
                    value={groqKeyInput}
                    onChange={(e) => setGroqKeyInput(e.target.value)}
                    placeholder={aiConfig?.hasGroqKey ? "••••••••••••• (ya configurada — dejá vacío para no cambiar)" : "gsk_xxxxxxxxxxxxxxxx"}
                    className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 pr-10 py-2.5 text-sm outline-none focus:border-[#7c4dff] focus:bg-white transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroqKey(!showGroqKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#667781] hover:text-[#111b21]"
                  >
                    {showGroqKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-[#667781] mb-1.5 block font-semibold">Nombre del asistente</label>
                <input
                  type="text"
                  value={aiConfig.name}
                  onChange={(e) => setAiConfig({ ...aiConfig, name: e.target.value })}
                  className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7c4dff] focus:bg-white transition-colors"
                />
              </div>

              <div>
                <label className="text-xs text-[#667781] mb-1.5 block font-semibold">
                  Prompt del sistema
                </label>
                <textarea
                  value={aiConfig.systemPrompt}
                  onChange={(e) => setAiConfig({ ...aiConfig, systemPrompt: e.target.value })}
                  rows={9}
                  className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7c4dff] focus:bg-white transition-colors resize-none font-mono leading-relaxed"
                  placeholder="Describí cómo debe comportarse el asistente..."
                />
                <p className="text-[11px] text-[#667781] mt-1">
                  {aiConfig.systemPrompt.length} caracteres · El catálogo de productos se agrega automáticamente al contexto
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#667781] mb-1.5 block font-semibold">
                    Temperatura: {aiConfig.temperature}
                  </label>
                  <input
                    type="range" min="0" max="1" step="0.1"
                    value={aiConfig.temperature}
                    onChange={(e) => setAiConfig({ ...aiConfig, temperature: parseFloat(e.target.value) })}
                    className="w-full accent-[#7c4dff]"
                  />
                  <div className="flex justify-between text-[10px] text-[#aebac1] mt-0.5">
                    <span>Preciso</span><span>Creativo</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#667781] mb-1.5 block font-semibold">Máx. tokens</label>
                  <input
                    type="number" min={100} max={2000} step={50}
                    value={aiConfig.maxTokens}
                    onChange={(e) => setAiConfig({ ...aiConfig, maxTokens: parseInt(e.target.value) })}
                    className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7c4dff] focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-[#667781] mb-2 block font-semibold">Incluir catálogo de productos en el contexto</label>
                <button
                  onClick={() => setAiConfig({ ...aiConfig, includeProducts: !aiConfig.includeProducts })}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border",
                    aiConfig.includeProducts
                      ? "bg-green-50 text-[#008069] border-green-200"
                      : "bg-[#f0f2f5] text-[#667781] border-[#e9edef]"
                  )}
                >
                  <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", aiConfig.includeProducts ? "bg-[#008069] border-[#008069]" : "border-[#aebac1]")}>
                    {aiConfig.includeProducts && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </div>
                  {aiConfig.includeProducts ? "Activado — la IA conoce tus productos" : "Desactivado"}
                </button>
              </div>

              <button
                onClick={saveAI}
                disabled={savingAI}
                className="flex items-center gap-2 bg-[#7c4dff] hover:bg-[#6a3deb] text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 shadow-sm"
              >
                {savingAI ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar configuración IA
              </button>
            </div>
          )}
        </div>

        {/* ─── WhatsApp ─── */}
        <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden shadow-sm">
          <SectionBtn id="wa" icon={Webhook} title="WhatsApp Business" subtitle="Meta Cloud API — Token y Phone ID" color="bg-[#008069]" />

          {open === "wa" && (
            <div className="px-5 pb-5 space-y-4 border-t border-[#e9edef] pt-4">
              {[
                { key: "phoneNumberId", label: "Phone Number ID",            placeholder: "123456789012345" },
                { key: "businessId",    label: "Business Account ID (opcional)", placeholder: "987654321098765" },
                { key: "verifyToken",   label: "Verify Token (lo elegís vos)", placeholder: "mi_token_secreto_2026" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-[#667781] mb-1.5 block font-semibold">{f.label}</label>
                  <input
                    type="text"
                    placeholder={f.placeholder}
                    value={(waConfig as Record<string, string>)[f.key] ?? ""}
                    onChange={(e) => setWaConfig({ ...waConfig, [f.key]: e.target.value })}
                    className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#008069] focus:bg-white transition-colors font-mono"
                  />
                </div>
              ))}

              <div>
                <label className="text-xs text-[#667781] mb-1.5 block font-semibold flex items-center gap-1">
                  <Key className="w-3 h-3" /> Access Token permanente
                </label>
                <input
                  type="password"
                  placeholder="EAABxxxxxxxxxxxxxxx..."
                  value={waConfig.accessToken ?? ""}
                  onChange={(e) => setWaConfig({ ...waConfig, accessToken: e.target.value })}
                  className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#008069] focus:bg-white transition-colors font-mono"
                />
              </div>

              {/* Webhook URL */}
              <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                <p className="text-[11px] text-[#667781] font-semibold mb-1">URL del Webhook → pegá esto en Meta</p>
                <code className="text-xs text-[#008069] break-all font-mono">{appUrl}/api/webhook</code>
              </div>

              <button
                onClick={saveWA}
                disabled={savingWA}
                className="flex items-center gap-2 bg-[#008069] hover:bg-[#017561] text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 shadow-sm"
              >
                {savingWA ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar WhatsApp
              </button>
            </div>
          )}
        </div>

        {/* ─── Cómo funciona ─── */}
        <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden shadow-sm">
          <SectionBtn id="info" icon={Info} title="Cómo funciona" subtitle="Flujo de automatización" color="bg-[#3b82f6]" />
          {open === "info" && (
            <div className="px-5 pb-5 border-t border-[#e9edef] pt-4">
              <ol className="space-y-3">
                {[
                  "El cliente te escribe por WhatsApp",
                  "Meta reenvía el mensaje a tu webhook (/api/webhook)",
                  "La plataforma guarda el mensaje y lo muestra en tiempo real",
                  "Si la IA está habilitada, Groq Llama genera una respuesta usando tu prompt + el catálogo de productos",
                  "La respuesta se envía automáticamente por WhatsApp Cloud API",
                  "Podés pausar la IA en cualquier momento y escribirle vos al cliente",
                  "El carrito permite armar pedidos y enviarlos por chat",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-[#008069] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm text-[#667781] leading-relaxed">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
