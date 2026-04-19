"use client";

import { Message } from "@/lib/types";
import { formatMessageTime } from "@/lib/utils";
import { Bot, User2, CheckCheck, Check, Clock, Play, Pause, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useRef } from "react";

interface MessageBubbleProps {
  message: Message;
}

// WhatsApp text formatter: *bold*, _italic_, ~strike~
function WAText({ text }: { text: string }) {
  if (!text) return null;
  const segments: React.ReactNode[] = [];
  const regex = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push(text.slice(lastIdx, match.index));
    }
    const raw = match[0];
    const inner = raw.slice(1, -1);
    if (raw.startsWith("*"))  segments.push(<strong key={key++} className="font-semibold">{inner}</strong>);
    else if (raw.startsWith("_")) segments.push(<em key={key++}>{inner}</em>);
    else if (raw.startsWith("~")) segments.push(<del key={key++} className="opacity-60">{inner}</del>);
    lastIdx = match.index + raw.length;
  }
  if (lastIdx < text.length) segments.push(text.slice(lastIdx));

  return <>{segments}</>;
}

export function AudioPlayer({ mediaId }: { mediaId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const src = `/api/media/${mediaId}`;

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  }

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    setProgress((a.currentTime / a.duration) * 100);
  }

  function onLoaded() {
    setDuration(audioRef.current?.duration ?? 0);
  }

  function onEnded() { setPlaying(false); setProgress(0); }

  function seekTo(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = ratio * a.duration;
  }

  const fmt = (s: number) => (!isFinite(s) || isNaN(s)) ? "0:00" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoaded}
        onEnded={onEnded}
        preload="metadata"
      />
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full bg-[#008069] flex items-center justify-center flex-shrink-0 hover:bg-[#017561] transition-colors"
      >
        {playing
          ? <Pause className="w-4 h-4 text-white" />
          : <Play className="w-4 h-4 text-white ml-0.5" />
        }
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div
          className="h-1.5 bg-[#dfe5e7] rounded-full cursor-pointer relative"
          onClick={seekTo}
        >
          <div
            className="h-full bg-[#008069] rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-[#667781]">
          {fmt(duration > 0 ? (progress / 100) * duration : 0)} / {fmt(duration)}
        </span>
      </div>
      <Mic className="w-4 h-4 text-[#667781] flex-shrink-0" />
    </div>
  );
}

function ImageMessage({ mediaId, caption }: { mediaId: string; caption?: string }) {
  const [open, setOpen] = useState(false);
  const src = `/api/media/${mediaId}`;
  return (
    <>
      <div
        className="cursor-pointer rounded-xl overflow-hidden max-w-[240px]"
        onClick={() => setOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caption || "Imagen"}
          className="w-full object-cover rounded-xl hover:opacity-90 transition-opacity"
          loading="lazy"
        />
        {caption && (
          <p className="text-sm text-[#111b21] mt-1.5 leading-relaxed">
            <WAText text={caption} />
          </p>
        )}
      </div>

      {/* Lightbox */}
      {open && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption || "Imagen"} className="max-w-full max-h-full rounded-xl shadow-2xl" />
        </div>
      )}
    </>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOut = message.direction === "outbound";
  const isAI  = message.sender === "ai";

  const tick = {
    sent:      <Check      className="w-3 h-3 text-[#667781]" />,
    delivered: <CheckCheck className="w-3 h-3 text-[#667781]" />,
    read:      <CheckCheck className="w-3 h-3 text-[#53bdeb]" />,
    failed:    <span className="text-red-500 text-[10px] font-bold">!</span>,
  }[message.status] ?? <Clock className="w-3 h-3 text-[#667781]" />;

  // Parse metadata
  let meta: Record<string, string> = {};
  try { if (message.metadata) meta = JSON.parse(message.metadata); } catch { /* noop */ }

  const isImage = message.type === "image" && meta.mediaId;
  const isAudio = message.type === "audio" && meta.mediaId;

  return (
    <div className={cn("flex items-end gap-1.5 px-4 py-0.5", isOut ? "justify-end" : "justify-start")}>
      {/* Avatar for inbound */}
      {!isOut && (
        <div className="w-7 h-7 rounded-full bg-[#dfe5e7] flex items-center justify-center flex-shrink-0 mb-1">
          <User2 className="w-4 h-4 text-[#667781]" />
        </div>
      )}

      <div className={cn(
        "max-w-[72%] sm:max-w-[62%] rounded-2xl px-3 py-2 shadow-sm relative",
        isOut ? "bg-[#d9fdd3] rounded-br-sm" : "bg-white rounded-bl-sm"
      )}>
        {/* Sender label for outbound */}
        {isOut && (
          <div className="flex items-center gap-1 mb-0.5">
            {isAI
              ? <><Bot   className="w-3 h-3 text-[#7c4dff]" /><span className="text-[10px] text-[#7c4dff] font-semibold">IA</span></>
              : <><User2 className="w-3 h-3 text-[#00a884]" /><span className="text-[10px] text-[#00a884] font-semibold">Agente</span></>
            }
          </div>
        )}

        {/* Content */}
        {isImage ? (
          <ImageMessage mediaId={meta.mediaId} caption={meta.caption || message.content !== "[Imagen]" ? message.content : undefined} />
        ) : isAudio ? (
          <div className="space-y-1.5">
            <AudioPlayer mediaId={meta.mediaId} />
            {message.content && message.content !== "[audio]" && message.content !== "[Audio]" && (
              <p className="text-[11px] text-[#667781] italic leading-relaxed">
                📝 {message.content}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[#111b21] leading-relaxed whitespace-pre-wrap break-words">
            <WAText text={message.content} />
          </p>
        )}

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
