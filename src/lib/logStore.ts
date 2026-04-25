// In-memory circular log buffer — max 500 entries
export interface LogEntry {
  id: number;
  ts: string;   // ISO timestamp
  level: "info" | "warn" | "error" | "debug";
  msg: string;
}

const MAX_LOGS = 500;
let counter = 0;
const logs: LogEntry[] = [];

// SSE subscribers
type Subscriber = (entry: LogEntry) => void;
const subscribers = new Set<Subscriber>();

export function pushLog(level: LogEntry["level"], msg: string) {
  const entry: LogEntry = {
    id: ++counter,
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (logs.length >= MAX_LOGS) logs.shift();
  logs.push(entry);
  subscribers.forEach((fn) => fn(entry));
}

export function getLogs(): LogEntry[] {
  return [...logs];
}

export function subscribeToLogs(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Patch global console so every console.log/warn/error also goes to the store
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function serialize(...args: unknown[]): string {
  return args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
}

console.log = (...args: unknown[]) => {
  _origLog(...args);
  pushLog("info", serialize(...args));
};
console.warn = (...args: unknown[]) => {
  _origWarn(...args);
  pushLog("warn", serialize(...args));
};
console.error = (...args: unknown[]) => {
  _origError(...args);
  pushLog("error", serialize(...args));
};
console.debug = (...args: unknown[]) => {
  _origLog(...args);
  pushLog("debug", serialize(...args));
};
