"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Trash2, Pause, Play, Download, RefreshCw } from "lucide-react";

interface LogEntry {
  id: number;
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  msg: string;
}

const LEVEL_STYLES: Record<LogEntry["level"], string> = {
  info:  "text-green-400",
  warn:  "text-yellow-400",
  error: "text-red-400",
  debug: "text-blue-400",
};

const LEVEL_BADGE: Record<LogEntry["level"], string> = {
  info:  "bg-green-900/60 text-green-300",
  warn:  "bg-yellow-900/60 text-yellow-300",
  error: "bg-red-900/60 text-red-300",
  debug: "bg-blue-900/60 text-blue-300",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | LogEntry["level"]>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);

  pausedRef.current = paused;

  const connect = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource("/api/logs?stream=1");
    esRef.current = es;
    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const entry: LogEntry = JSON.parse(e.data);
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch { /* ignore parse error */ }
    };
    es.onerror = () => {
      es.close();
      setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  // Auto-scroll to bottom unless paused
  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, paused]);

  const filtered = logs.filter((l) => {
    if (levelFilter !== "all" && l.level !== levelFilter) return false;
    if (filter && !l.msg.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString("es-AR", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function clearLogs() {
    setLogs([]);
  }

  function downloadLogs() {
    const text = filtered.map((l) => `[${l.ts}] [${l.level.toUpperCase()}] ${l.msg}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 19)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-[#e6edf3] font-mono text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#161b22] border-b border-[#30363d] shrink-0">
        <span className="text-[#58a6ff] font-bold text-sm mr-1">🖥 Logs</span>

        {/* Level filter */}
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)}
          className="bg-[#21262d] border border-[#30363d] rounded px-2 py-1 text-xs text-[#e6edf3] focus:outline-none"
        >
          <option value="all">Todos</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>

        {/* Text filter */}
        <input
          type="text"
          placeholder="Filtrar..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[120px] bg-[#21262d] border border-[#30363d] rounded px-2 py-1 text-xs text-[#e6edf3] placeholder:text-[#484f58] focus:outline-none focus:border-[#58a6ff]"
        />

        <span className="text-[#484f58] text-xs">{filtered.length} líneas</span>

        <button
          onClick={() => setPaused((p) => !p)}
          title={paused ? "Reanudar" : "Pausar"}
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
        >
          {paused ? <Play className="w-3 h-3 text-green-400" /> : <Pause className="w-3 h-3 text-yellow-400" />}
          <span className="hidden sm:inline">{paused ? "Reanudar" : "Pausar"}</span>
        </button>

        <button
          onClick={connect}
          title="Reconectar"
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
        >
          <RefreshCw className="w-3 h-3 text-[#58a6ff]" />
          <span className="hidden sm:inline">Reconectar</span>
        </button>

        <button
          onClick={downloadLogs}
          title="Descargar"
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
        >
          <Download className="w-3 h-3 text-[#58a6ff]" />
          <span className="hidden sm:inline">Descargar</span>
        </button>

        <button
          onClick={clearLogs}
          title="Limpiar"
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
        >
          <Trash2 className="w-3 h-3 text-red-400" />
          <span className="hidden sm:inline">Limpiar</span>
        </button>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-[2px]">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-[#484f58]">
            Esperando eventos... Mandá un mensaje de WhatsApp para ver los logs.
          </div>
        )}
        {filtered.map((l) => (
          <div
            key={l.id}
            className={`flex gap-2 items-start py-[2px] px-1 rounded hover:bg-[#161b22] transition-colors ${l.level === "error" ? "bg-red-950/20" : ""}`}
          >
            <span className="text-[#484f58] shrink-0 w-[88px]">{fmtTime(l.ts)}</span>
            <span className={`shrink-0 px-1 rounded text-[10px] font-bold uppercase ${LEVEL_BADGE[l.level]}`}>
              {l.level}
            </span>
            <span className={`break-all leading-relaxed ${LEVEL_STYLES[l.level]}`}>{l.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1 bg-[#161b22] border-t border-[#30363d] text-[#484f58] text-[10px] shrink-0">
        <span className={`w-2 h-2 rounded-full ${paused ? "bg-yellow-500" : "bg-green-500 animate-pulse"}`} />
        <span>{paused ? "Pausado" : "En vivo"}</span>
        <span className="ml-auto">/logs — {logs.length} entradas totales</span>
      </div>
    </div>
  );
}
