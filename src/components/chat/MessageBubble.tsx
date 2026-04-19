"use client";

import { Message } from "@/lib/types";
import { formatMessageTime } from "@/lib/utils";
import { Bot, User2, CheckCheck, Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOut = message.direction === "outbound";
  const isAI  = message.sender === "ai";

  const tick = {
    sent:      <Check     className="w-3 h-3 text-[#667781]" />,
    delivered: <CheckCheck className="w-3 h-3 text-[#667781]" />,
    read:      <CheckCheck className="w-3 h-3 text-[#53bdeb]" />,
    failed:    <span className="text-red-500 text-[10px] font-bold">!</span>,
  }[message.status] ?? <Clock className="w-3 h-3 text-[#667781]" />;

  return (
    <div className={cn("flex items-end gap-1.5 px-4 py-0.5", isOut ? "justify-end" : "justify-start")}>
      {/* Avatar for inbound */}
      {!isOut && (
        <div className="w-7 h-7 rounded-full bg-[#dfe5e7] flex items-center justify-center flex-shrink-0 mb-1">
          <User2 className="w-4 h-4 text-[#667781]" />
        </div>
      )}

      <div className={cn(
        "max-w-[70%] sm:max-w-[60%] rounded-2xl px-3 py-2 shadow-sm relative",
        isOut ? "bg-[#d9fdd3] rounded-br-sm" : "bg-white rounded-bl-sm"
      )}>
        {/* Sender label for outbound */}
        {isOut && (
          <div className="flex items-center gap-1 mb-0.5">
            {isAI
              ? <><Bot    className="w-3 h-3 text-[#7c4dff]" /><span className="text-[10px] text-[#7c4dff] font-semibold">IA</span></>
              : <><User2  className="w-3 h-3 text-[#00a884]" /><span className="text-[10px] text-[#00a884] font-semibold">Agente</span></>
            }
          </div>
        )}

        <p className="text-sm text-[#111b21] leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </p>

        <div className={cn("flex items-center gap-1 mt-0.5", isOut ? "justify-end" : "justify-start")}>
          <span className="text-[11px] text-[#667781]">
            {formatMessageTime(new Date(message.createdAt))}
          </span>
          {isOut && <span>{tick}</span>}
        </div>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-end gap-1.5 px-4 py-0.5 justify-start message-in">
      <div className="w-7 h-7 rounded-full bg-[#dfe5e7] flex items-center justify-center flex-shrink-0">
        <Bot className="w-4 h-4 text-[#7c4dff]" />
      </div>
      <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}

export function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center justify-center py-3">
      <span className="bg-white/80 backdrop-blur-sm text-[#667781] text-xs px-4 py-1.5 rounded-full shadow-sm">
        {date}
      </span>
    </div>
  );
}
