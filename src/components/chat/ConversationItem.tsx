"use client";

import { ConversationListItem } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { formatConversationTime } from "@/lib/utils";
import { Bot, PauseCircle, CheckCheck, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationItemProps {
  conversation: ConversationListItem;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationItem({ conversation, isSelected, onClick }: ConversationItemProps) {
  const { contact, lastMessage, lastMessageAt, unreadCount, aiEnabled, aiPaused } = conversation;
  const displayName = contact.name ?? contact.phone;
  const lastText = lastMessage?.content ?? "";
  const truncated = lastText.length > 42 ? lastText.slice(0, 42) + "…" : lastText;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-[#f0f2f5]",
        isSelected ? "bg-[#f0f2f5]" : "bg-white hover:bg-[#f5f6f6]"
      )}
    >
      {/* Avatar + IA badge */}
      <div className="relative flex-shrink-0">
        <Avatar name={contact.name} phone={contact.phone} src={contact.avatarUrl} size="md" />
        {aiEnabled && (
          <div className={cn(
            "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm",
            aiPaused ? "bg-amber-400" : "bg-[#7c4dff]"
          )}>
            {aiPaused
              ? <PauseCircle className="w-2.5 h-2.5 text-white" />
              : <Bot className="w-2.5 h-2.5 text-white" />}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className={cn("text-sm truncate", unreadCount > 0 ? "font-semibold text-[#111b21]" : "font-medium text-[#111b21]")}>
            {displayName}
          </span>
          <span className={cn("text-[11px] flex-shrink-0 ml-2", unreadCount > 0 ? "text-[#25d366] font-semibold" : "text-[#667781]")}>
            {formatConversationTime(lastMessageAt)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {lastMessage?.direction === "outbound" && (
              lastMessage.status === "read"
                ? <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb] flex-shrink-0" />
                : <Check className="w-3.5 h-3.5 text-[#667781] flex-shrink-0" />
            )}
            {lastMessage?.sender === "ai" && (
              <Bot className="w-3 h-3 text-[#7c4dff] flex-shrink-0" />
            )}
            <span className={cn("text-[13px] truncate", unreadCount > 0 ? "text-[#111b21]" : "text-[#667781]")}>
              {truncated || "Sin mensajes aún"}
            </span>
          </div>
          <Badge count={unreadCount} />
        </div>
      </div>
    </button>
  );
}
