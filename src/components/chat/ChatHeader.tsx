"use client";

import { ConversationListItem } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Bot, Search, MoreVertical, PauseCircle, Play, UserCheck, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface ChatHeaderProps {
  conversation: ConversationListItem;
  onToggleAI: () => void;
  onTogglePause: () => void;
  onResolve: () => void;
  onBack?: () => void;
}

export function ChatHeader({ conversation, onToggleAI, onTogglePause, onResolve, onBack }: ChatHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  const { contact, aiEnabled, aiPaused } = conversation;
  const name = contact.name ?? contact.phone;

  const aiStatus = !aiEnabled ? "off" : aiPaused ? "paused" : "on";

  return (
    <div className="flex items-center gap-3 px-3 sm:px-4 py-3 bg-[#f0f2f5] border-b border-[#e9edef]">
      {/* Mobile back */}
      {onBack && (
        <button onClick={onBack} className="sm:hidden p-1.5 -ml-1 text-[#54656f] hover:text-[#111b21]">
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}

      <Avatar name={contact.name} phone={contact.phone} src={contact.avatarUrl} size="md" />

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-[#111b21] truncate">{name}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {contact.name && (
            <span className="text-[11px] text-[#667781] truncate">📱 {contact.phone}</span>
          )}
          <span className={cn(
            "text-xs flex items-center gap-1",
            aiStatus === "on"     && "text-[#7c4dff]",
            aiStatus === "paused" && "text-amber-500",
            aiStatus === "off"    && "text-[#667781]",
          )}>
            {aiStatus === "on"     && <><Bot          className="w-3 h-3" />IA activa</>}
            {aiStatus === "paused" && <><PauseCircle  className="w-3 h-3" />IA pausada</>}
            {aiStatus === "off"    && <><UserCheck    className="w-3 h-3" />Manual</>}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        {/* AI toggle */}
        <button
          onClick={onToggleAI}
          title={aiEnabled ? "Deshabilitar IA" : "Habilitar IA"}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all",
            aiEnabled
              ? "bg-[#7c4dff] text-white hover:bg-[#6a3deb]"
              : "bg-[#e9edef] text-[#667781] hover:bg-[#dfe5e7]"
          )}
        >
          <Bot className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">IA</span>
        </button>

        {/* Pause/Resume */}
        {aiEnabled && (
          <button
            onClick={onTogglePause}
            title={aiPaused ? "Reanudar IA" : "Pausar IA"}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all ml-1",
              aiPaused
                ? "bg-amber-400 text-white hover:bg-amber-500"
                : "bg-[#e9edef] text-[#667781] hover:bg-[#dfe5e7]"
            )}
          >
            {aiPaused ? <Play className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{aiPaused ? "Reanudar" : "Pausar"}</span>
          </button>
        )}

        <button className="p-2 text-[#54656f] hover:text-[#111b21] rounded-full hover:bg-[#e9edef] transition-colors ml-0.5">
          <Search className="w-5 h-5" />
        </button>

        {/* More menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 text-[#54656f] hover:text-[#111b21] rounded-full hover:bg-[#e9edef] transition-colors"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl z-50 py-1.5 border border-[#e9edef]">
                <button
                  onClick={() => { onResolve(); setShowMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#111b21] hover:bg-[#f0f2f5] flex items-center gap-3"
                >
                  <UserCheck className="w-4 h-4 text-[#00a884]" />
                  Marcar como resuelto
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
