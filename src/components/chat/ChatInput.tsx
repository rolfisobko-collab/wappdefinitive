"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Send, Paperclip, Bot, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (content: string) => void;
  aiPaused: boolean;
  aiEnabled: boolean;
  isLoading?: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, aiPaused, aiEnabled, isLoading, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const t = value.trim();
    if (!t || isLoading || disabled) return;
    onSend(t);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onInput = () => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + "px";
  };

  const isManual = aiEnabled && aiPaused;

  return (
    <div className="bg-[#f0f2f5] border-t border-[#e9edef] px-2 sm:px-4 py-2">
      {/* Status bar */}
      {(isManual || (aiEnabled && !aiPaused)) && (
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1 mb-2 rounded-lg text-xs font-medium w-fit",
          isManual ? "bg-amber-50 text-amber-600" : "bg-purple-50 text-purple-600"
        )}>
          {isManual
            ? <><PauseCircle className="w-3 h-3" /> Modo manual — IA pausada</>
            : <><Bot className="w-3 h-3" /> IA respondiendo automáticamente</>
          }
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          className="p-2 text-[#54656f] hover:text-[#111b21] transition-colors rounded-full hover:bg-[#e9edef] flex-shrink-0"
          title="Adjuntar archivo"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Textarea container */}
        <div className="flex-1 bg-white rounded-2xl px-4 py-2.5 flex items-end gap-2 shadow-sm">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onInput={onInput}
            onKeyDown={onKey}
            disabled={disabled}
            placeholder={
              disabled ? "Seleccioná una conversación…"
              : isManual ? "Escribí tu mensaje (IA pausada)…"
              : "Escribí un mensaje…"
            }
            rows={1}
            className="flex-1 bg-transparent text-sm text-[#111b21] placeholder-[#667781] resize-none outline-none leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed max-h-[120px]"
            style={{ height: "20px" }}
          />
        </div>

        <button
          onClick={send}
          disabled={!value.trim() || isLoading || disabled}
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center transition-all flex-shrink-0 shadow-sm",
            value.trim() && !disabled
              ? "bg-[#008069] hover:bg-[#017561] text-white"
              : "bg-[#e9edef] text-[#aebac1]"
          )}
        >
          {isLoading
            ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            : <Send className="w-4 h-4" />
          }
        </button>
      </div>
    </div>
  );
}
