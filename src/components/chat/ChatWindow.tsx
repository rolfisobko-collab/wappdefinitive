"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useChatStore } from "@/store/chatStore";
import { Message, ConversationListItem } from "@/lib/types";
import { CartMongoItem } from "@/lib/db";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { MessageBubble, TypingIndicator, DateSeparator } from "./MessageBubble";
import { CartPanel } from "./CartPanel";
import { MediaPanel } from "./MediaPanel";
import { getSocket } from "@/lib/socket";
import { useToast } from "@/components/ui/Toast";
import { format, isToday, isYesterday } from "date-fns";

function fUSD(n: number) { return `USD ${n.toFixed(0)}`; }
function fARS(n: number) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n); }
import { es } from "date-fns/locale";
import { ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatWindowProps {
  conversationId: string;
  onBack?: () => void;
}

export function ChatWindow({ conversationId, onBack }: ChatWindowProps) {
  const { conversations, messages, carts, addMessage, setMessages, setCart, updateConversation, markAsRead } =
    useChatStore();
  const { toast } = useToast();
  const [isTyping, setIsTyping]   = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showCart, setShowCart]   = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);

  const conversation = conversations.find((c) => c.id === conversationId);
  const convMessages = messages[conversationId] ?? [];
  const cart         = carts[conversationId] ?? null;

  useEffect(() => {
    if (!conversationId) return;
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(conversationId, data.messages ?? []);
        setCart(conversationId, data.cart ?? null);
        markAsRead(conversationId);
      })
      .catch(() => toast("Error al cargar mensajes", "error"));
  }, [conversationId]);


  useEffect(() => {
    const socket = getSocket();
    socket.emit("join-conversation", conversationId);

    socket.on("new-message", ({ conversationId: cid, message }: { conversationId: string; message: Message }) => {
      if (cid !== conversationId) return;
      addMessage(conversationId, message);
      markAsRead(conversationId);
    });

    socket.on("ai-response", ({ conversationId: cid, message }: { conversationId: string; message: Message }) => {
      if (cid !== conversationId) return;
      setIsTyping(false);
      addMessage(conversationId, message);
    });

    socket.on("cart-updated", ({ conversationId: cid, cart: updatedCart }: { conversationId: string; cart: unknown }) => {
      if (cid !== conversationId) return;
      setCart(conversationId, updatedCart as never);
    });

    return () => {
      socket.emit("leave-conversation", conversationId);
      socket.off("new-message");
      socket.off("ai-response");
      socket.off("cart-updated");
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convMessages.length, isTyping]);

  const handleSend = useCallback(async (content: string) => {
    if (isSending) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, isManual: true }),
      });
      if (!res.ok) throw new Error();
      const msg: Message = await res.json();
      addMessage(conversationId, msg);

      if (conversation?.aiEnabled && !conversation?.aiPaused) {
        setIsTyping(true);
        setTimeout(async () => {
          try {
            await fetch(`/api/conversations/${conversationId}/messages`, { method: "PUT" });
          } catch { setIsTyping(false); }
        }, 600);
      }
    } catch {
      toast("Error al enviar mensaje", "error");
    } finally {
      setIsSending(false);
    }
  }, [conversationId, conversation, isSending]);

  const handleToggleAI = async () => {
    if (!conversation) return;
    const val = !conversation.aiEnabled;
    updateConversation(conversationId, { aiEnabled: val });
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiEnabled: val }),
    });
    toast(val ? "IA habilitada" : "IA deshabilitada", "info");
  };

  const handleTogglePause = async () => {
    if (!conversation) return;
    const val = !conversation.aiPaused;
    updateConversation(conversationId, { aiPaused: val });
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiPaused: val }),
    });
    toast(val ? "IA pausada — escribí vos al cliente" : "IA reanudada ✓", val ? "info" : "success");
  };

  const handleResolve = async () => {
    updateConversation(conversationId, { status: "resolved" });
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    toast("Conversación resuelta", "success");
  };

  const handleSendCart = async () => {
    const items = (cart as { items?: CartMongoItem[] } | null)?.items ?? [];
    if (!items.length) return;
    const lines = items.map((i) => `• ${i.name} × ${i.quantity} = ${fUSD(i.unitPriceUSD * i.quantity)} | ${fARS(i.unitPriceARS * i.quantity)}`).join("\n");
    const totalUSD = items.reduce((s, i) => s + i.unitPriceUSD * i.quantity, 0);
    const totalARS = items.reduce((s, i) => s + i.unitPriceARS * i.quantity, 0);
    await handleSend(`🛒 *Tu carrito:*\n\n${lines}\n\n*Total: ${fUSD(totalUSD)} | ${fARS(totalARS)}*\n\n¿Confirmás el pedido?`);
    toast("Carrito enviado al cliente ✓", "success");
  };

  // Group messages by date
  const grouped = convMessages.reduce<Array<{ date: string; messages: Message[] }>>((acc, msg) => {
    const d = new Date(msg.createdAt);
    const label = isToday(d) ? "Hoy" : isYesterday(d) ? "Ayer" : format(d, "d 'de' MMMM 'de' yyyy", { locale: es });
    const last = acc[acc.length - 1];
    if (last?.date === label) last.messages.push(msg);
    else acc.push({ date: label, messages: [msg] });
    return acc;
  }, []);

  if (!conversation) return null;

  const cartItemCount = cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          conversation={conversation}
          onToggleAI={handleToggleAI}
          onTogglePause={handleTogglePause}
          onResolve={handleResolve}
          onBack={onBack}
          onToggleMedia={() => { setShowMedia(!showMedia); setShowCart(false); }}
          showMedia={showMedia}
        />

        {/* Messages */}
        <div className="flex-1 overflow-y-auto chat-bg py-2">
          {grouped.map((group) => (
            <div key={group.date}>
              <DateSeparator date={group.date} />
              {group.messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </div>
          ))}
          {isTyping && <TypingIndicator />}
          <div ref={bottomRef} className="h-2" />
        </div>

        {/* Cart FAB */}
        <div className="relative">
          <button
            onClick={() => { setShowCart(!showCart); setShowMedia(false); }}
            className={cn(
              "absolute -top-14 right-4 flex items-center gap-2 px-3 py-2 rounded-full text-sm font-semibold shadow-md transition-all",
              cartItemCount > 0
                ? "bg-[#008069] text-white hover:bg-[#017561]"
                : "bg-white text-[#667781] hover:bg-[#f0f2f5] border border-[#e9edef]"
            )}
          >
            <ShoppingCart className="w-4 h-4" />
            {cartItemCount > 0 && <span>{cartItemCount}</span>}
          </button>
        </div>

        <ChatInput
          onSend={handleSend}
          aiEnabled={conversation.aiEnabled}
          aiPaused={conversation.aiPaused}
          isLoading={isSending}
        />
      </div>

      {showCart && (
        <CartPanel
          cart={cart as { id: string; items: CartMongoItem[] } | null}
          conversationId={conversationId}
          onCartChange={(c) => setCart(conversationId, c as never)}
          onSendCart={handleSendCart}
          onClose={() => setShowCart(false)}
        />
      )}

      {showMedia && (
        <MediaPanel
          messages={convMessages}
          onClose={() => setShowMedia(false)}
        />
      )}
    </div>
  );
}
