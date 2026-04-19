"use client";

import { useState } from "react";
import { useChatStore } from "@/store/chatStore";
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { ProductsPanel } from "@/components/products/ProductsPanel";
import { ToastProvider } from "@/components/ui/Toast";
import { MessageSquare, Bot, Zap } from "lucide-react";

export default function Home() {
  const { selectedConversationId, sidebarTab, selectConversation } = useChatStore();
  // Mobile: true = showing chat, false = showing sidebar
  const [mobileShowChat, setMobileShowChat] = useState(false);

  function handleSelect(id: string) {
    selectConversation(id);
    setMobileShowChat(true);
  }

  function handleBack() {
    setMobileShowChat(false);
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-[#f0f2f5]">

        {/* Sidebar — hidden on mobile when chat is open */}
        <div className={`
          ${mobileShowChat ? "hidden sm:flex" : "flex"}
          w-full sm:w-[340px] flex-shrink-0 flex-col h-full
        `}>
          <ConversationSidebar onSelectConversation={handleSelect} />
        </div>

        {/* Main area */}
        <div className={`
          ${!mobileShowChat ? "hidden sm:flex" : "flex"}
          flex-1 flex-col overflow-hidden
        `}>
          {sidebarTab === "chats" ? (
            selectedConversationId ? (
              <ChatWindow
                key={selectedConversationId}
                conversationId={selectedConversationId}
                onBack={handleBack}
              />
            ) : (
              <EmptyState />
            )
          ) : sidebarTab === "products" ? (
            <ProductsPanel />
          ) : (
            <SettingsPanel />
          )}
        </div>

      </div>
    </ToastProvider>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] text-center px-6">
      <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm">
        <MessageSquare className="w-12 h-12 text-[#008069]" />
      </div>
      <h2 className="text-2xl font-bold text-[#111b21] mb-2">WApp Business Hub</h2>
      <p className="text-[#667781] text-sm max-w-xs leading-relaxed mb-8">
        Seleccioná un chat para empezar. Tu IA está lista para atender clientes automáticamente.
      </p>
      <div className="grid grid-cols-3 gap-3 max-w-xs w-full">
        {[
          { icon: Bot,          label: "IA personalizable", bg: "bg-purple-50",  text: "text-[#7c4dff]" },
          { icon: Zap,          label: "Respuestas al instante", bg: "bg-green-50", text: "text-[#008069]" },
          { icon: MessageSquare, label: "Control total", bg: "bg-blue-50", text: "text-blue-600" },
        ].map((f) => (
          <div key={f.label} className={`${f.bg} rounded-2xl p-4 flex flex-col items-center gap-2 shadow-sm`}>
            <f.icon className={`w-6 h-6 ${f.text}`} />
            <span className="text-xs text-[#667781] text-center leading-tight font-medium">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
