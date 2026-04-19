"use client";

import { useEffect, useState } from "react";
import { useChatStore } from "@/store/chatStore";
import { ConversationItem } from "./ConversationItem";
import { ConversationListItem } from "@/lib/types";
import { Search, Plus, MessageSquare, Settings, Bot, X, Filter, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { useToast } from "@/components/ui/Toast";

interface ConversationSidebarProps {
  onSelectConversation: (id: string) => void;
}

type FilterType = "all" | "ai" | "paused" | "manual";

export function ConversationSidebar({ onSelectConversation }: ConversationSidebarProps) {
  const {
    conversations, selectedConversationId, isLoadingConversations,
    searchQuery, sidebarTab,
    setConversations, setLoadingConversations, setSearchQuery,
    setSidebarTab, addMessage, updateConversation,
  } = useChatStore();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const [showNew, setShowNew] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    loadConversations();
    const t = setInterval(loadConversations, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socket.on("new-message", ({ conversationId, message }: { conversationId: string; message: import("@/lib/types").Message }) => {
      addMessage(conversationId, message);
    });
    socket.on("conversation-updated", ({ conversationId, updates }: { conversationId: string; updates: Partial<ConversationListItem> }) => {
      updateConversation(conversationId, updates);
    });
    return () => { socket.off("new-message"); socket.off("conversation-updated"); };
  }, []);

  async function loadConversations() {
    setLoadingConversations(true);
    try {
      const res = await fetch("/api/conversations");
      setConversations(await res.json());
    } catch { toast("Error al cargar chats", "error"); }
    finally { setLoadingConversations(false); }
  }

  async function createConversation() {
    if (!newPhone.trim()) return;
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: newPhone.trim(), name: newName.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      await loadConversations();
      setShowNew(false); setNewPhone(""); setNewName("");
      toast("Conversación creada", "success");
    } catch { toast("Error al crear conversación", "error"); }
  }

  const filtered = conversations.filter((c) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q
      || (c.contact.name ?? "").toLowerCase().includes(q)
      || c.contact.phone.includes(q)
      || (c.lastMessage?.content ?? "").toLowerCase().includes(q);
    const matchFilter =
      filter === "all" ||
      (filter === "ai"     && c.aiEnabled && !c.aiPaused) ||
      (filter === "paused" && c.aiEnabled &&  c.aiPaused) ||
      (filter === "manual" && !c.aiEnabled);
    return matchSearch && matchFilter;
  });

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  const tabs = [
    { id: "chats",    icon: MessageSquare, label: "Chats",    badge: totalUnread },
    { id: "products", icon: ShoppingBag,   label: "Catálogo" },
    { id: "settings", icon: Settings,      label: "Config." },
  ];

  return (
    <div className="w-full sm:w-[340px] flex-shrink-0 flex flex-col bg-white border-r border-[#e9edef] h-full">

      {/* App header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#008069]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-white leading-none">WApp Hub</h1>
            <p className="text-[11px] text-white/70 mt-0.5">Automatización con IA</p>
          </div>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          title="Nueva conversación"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex border-b border-[#e9edef] bg-white">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSidebarTab(tab.id as "chats" | "products" | "settings")}
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors relative",
              sidebarTab === tab.id
                ? "text-[#008069] border-b-2 border-[#008069] -mb-px"
                : "text-[#667781] hover:text-[#111b21]"
            )}
          >
            <tab.icon className="w-[18px] h-[18px]" />
            {tab.label}
            {tab.badge ? (
              <span className="absolute top-1.5 right-1/4 bg-[#25d366] text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Chats tab */}
      {sidebarTab === "chats" && (
        <>
          {/* Search */}
          <div className="px-3 py-2 bg-white">
            <div className="flex items-center gap-2 bg-[#f0f2f5] rounded-xl px-3 py-2">
              <Search className="w-4 h-4 text-[#667781] flex-shrink-0" />
              <input
                type="text"
                placeholder="Buscar o empezar nuevo chat"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-[#111b21] placeholder-[#667781] outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")}>
                  <X className="w-4 h-4 text-[#667781] hover:text-[#111b21]" />
                </button>
              )}
            </div>
          </div>

          {/* Filter chips */}
          <div className="px-3 pb-2 flex gap-1.5 overflow-x-auto bg-white">
            {([
              { id: "all", label: "Todos" },
              { id: "ai", label: "IA activa" },
              { id: "paused", label: "Pausados" },
              { id: "manual", label: "Manual" },
            ] as { id: FilterType; label: string }[]).map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors",
                  filter === f.id
                    ? "bg-[#008069] text-white"
                    : "bg-[#f0f2f5] text-[#667781] hover:bg-[#e9edef]"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {isLoadingConversations && conversations.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-[#008069] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-[#667781]">
                <Filter className="w-8 h-8 mb-2 opacity-25" />
                <p className="text-sm">Sin conversaciones</p>
              </div>
            ) : (
              filtered.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isSelected={selectedConversationId === conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* Modal nueva conversación */}
      {showNew && (
        <div className="absolute inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl fade-in">
            <h3 className="text-[#111b21] font-bold mb-4 text-base">Nueva conversación</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#667781] mb-1 block font-medium">Teléfono *</label>
                <input
                  type="tel"
                  placeholder="Ej: 5491134567890"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 py-2.5 text-sm outline-none placeholder-[#aebac1] focus:border-[#008069] focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-[#667781] mb-1 block font-medium">Nombre (opcional)</label>
                <input
                  type="text"
                  placeholder="Nombre del contacto"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-[#e9edef] bg-[#f0f2f5] text-[#111b21] rounded-xl px-3 py-2.5 text-sm outline-none placeholder-[#aebac1] focus:border-[#008069] focus:bg-white transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowNew(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#667781] bg-[#f0f2f5] hover:bg-[#e9edef] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={createConversation}
                disabled={!newPhone.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#008069] hover:bg-[#017561] text-white disabled:opacity-40 transition-colors"
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
