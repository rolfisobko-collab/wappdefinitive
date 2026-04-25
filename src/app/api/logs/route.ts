import { NextRequest, NextResponse } from "next/server";
import "@/lib/logStore"; // ensure patching runs
import { getLogs, subscribeToLogs, LogEntry } from "@/lib/logStore";

export const dynamic = "force-dynamic";

// GET /api/logs          → últimas N entradas (JSON)
// GET /api/logs?stream=1 → SSE stream en tiempo real
export async function GET(req: NextRequest) {
  const stream = req.nextUrl.searchParams.get("stream");

  if (stream === "1") {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;

    const readable = new ReadableStream({
      start(controller) {
        // Send existing logs first
        for (const entry of getLogs()) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
        }

        unsubscribe = subscribeToLogs((entry: LogEntry) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
          } catch {
            // client disconnected
          }
        });
      },
      cancel() {
        unsubscribe?.();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Plain JSON snapshot
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "200");
  const all = getLogs();
  return NextResponse.json(all.slice(-limit));
}
