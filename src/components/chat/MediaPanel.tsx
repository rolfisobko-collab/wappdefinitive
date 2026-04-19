"use client";

import { useState } from "react";
import { Message } from "@/lib/types";
import { X, Image as ImageIcon, Mic, FileText, ExternalLink } from "lucide-react";
import { AudioPlayer } from "./MessageBubble";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface MediaPanelProps {
  messages: Message[];
  onClose: () => void;
}

type Tab = "images" | "audio" | "links";

export function MediaPanel({ messages, onClose }: MediaPanelProps) {
  const [tab, setTab] = useState<Tab>("images");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const imageMsgs = messages.filter((m) => {
    if (m.type !== "image") return false;
    try { const meta = JSON.parse(m.metadata ?? "{}"); return !!meta.mediaId; } catch { return false; }
  });

  const audioMsgs = messages.filter((m) => {
    if (m.type !== "audio") return false;
    try { const meta = JSON.parse(m.metadata ?? "{}"); return !!meta.mediaId; } catch { return false; }
  });

  // Extract URLs from text messages
  const urlRegex = /https?:\/\/[^\s\])"]+/g;
  const linkMsgs = messages.filter((m) => m.type === "text" && urlRegex.test(m.content ?? ""))
    .flatMap((m) => {
      const urls = (m.content ?? "").match(urlRegex) ?? [];
      return urls.map((url) => ({ url, msg: m }));
    });

  const tabs = [
    { id: "images" as Tab, icon: ImageIcon, label: "Imágenes", count: imageMsgs.length },
    { id: "audio"  as Tab, icon: Mic,       label: "Audios",   count: audioMsgs.length },
    { id: "links"  as Tab, icon: ExternalLink, label: "Links", count: linkMsgs.length },
  ];

  return (
    <>
      <div className="flex flex-col h-full bg-white border-l border-[#e9edef] w-72 flex-shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#f0f2f5] border-b border-[#e9edef]">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#008069]" />
            <h3 className="font-semibold text-sm text-[#111b21]">Archivos del chat</h3>
          </div>
          <button onClick={onClose} className="p-1 text-[#667781] hover:text-[#111b21] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#e9edef]">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors relative",
                tab === t.id
                  ? "text-[#008069] border-b-2 border-[#008069] -mb-px"
                  : "text-[#667781] hover:text-[#111b21]"
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              {t.count > 0 && (
                <span className="absolute top-1 right-2 bg-[#008069] text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {/* Images grid */}
          {tab === "images" && (
            imageMsgs.length === 0 ? (
              <Empty icon={ImageIcon} text="Sin imágenes" />
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {imageMsgs.map((m) => {
                  let mediaId = "";
                  try { mediaId = JSON.parse(m.metadata ?? "{}").mediaId; } catch { /* noop */ }
                  const src = `/api/media/${mediaId}`;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setLightbox(src)}
                      className="aspect-square rounded-lg overflow-hidden bg-[#f0f2f5] hover:opacity-90 transition-opacity"
                      title={format(new Date(m.createdAt), "d MMM HH:mm", { locale: es })}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* Audio list */}
          {tab === "audio" && (
            audioMsgs.length === 0 ? (
              <Empty icon={Mic} text="Sin audios" />
            ) : (
              <div className="space-y-2">
                {audioMsgs.map((m) => {
                  let mediaId = "";
                  try { mediaId = JSON.parse(m.metadata ?? "{}").mediaId; } catch { /* noop */ }
                  return (
                    <div key={m.id} className="bg-[#f0f2f5] rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#667781]">
                          {m.direction === "inbound" ? "Cliente" : "Agente/IA"}
                        </span>
                        <span className="text-[10px] text-[#aebac1]">
                          {format(new Date(m.createdAt), "d MMM HH:mm", { locale: es })}
                        </span>
                      </div>
                      <AudioPlayer mediaId={mediaId} />
                      {m.content && m.content !== "[audio]" && m.content !== "[Audio]" && (
                        <p className="text-[11px] text-[#667781] italic leading-relaxed">
                          📝 {m.content}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Links list */}
          {tab === "links" && (
            linkMsgs.length === 0 ? (
              <Empty icon={ExternalLink} text="Sin links" />
            ) : (
              <div className="space-y-2">
                {linkMsgs.map(({ url, msg }, idx) => (
                  <a
                    key={idx}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 bg-[#f0f2f5] rounded-xl p-3 hover:bg-[#e9edef] transition-colors group"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#008069] flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[#008069] truncate group-hover:underline">{url}</p>
                      <p className="text-[10px] text-[#aebac1] mt-0.5">
                        {format(new Date(msg.createdAt), "d MMM HH:mm", { locale: es })}
                        {" · "}
                        {msg.direction === "inbound" ? "Cliente" : "Agente/IA"}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-xl shadow-2xl" />
          <button
            className="absolute top-4 right-4 p-2 bg-white/20 rounded-full text-white hover:bg-white/30"
            onClick={() => setLightbox(null)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </>
  );
}

function Empty({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-[#aebac1]">
      <Icon className="w-10 h-10 mb-2 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
