import { NextRequest, NextResponse } from "next/server";
import { getWAConfig } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params;
    if (!mediaId) return NextResponse.json({ error: "Missing mediaId" }, { status: 400 });

    const waConfig = (await getWAConfig()) as Record<string, string> | null;
    const token = waConfig?.accessToken;
    if (!token) {
      console.error("[media proxy] No access token in WA config");
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    // Step 1: Get download URL from WhatsApp media endpoint
    const metaRes = await fetch(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "WAppHub/1.0",
        },
      }
    );

    if (!metaRes.ok) {
      const errBody = await metaRes.text().catch(() => "");
      console.error(`[media proxy] WhatsApp meta error ${metaRes.status} for ${mediaId}:`, errBody);
      return NextResponse.json(
        { error: `WhatsApp API error: ${metaRes.status}`, detail: errBody },
        { status: metaRes.status === 401 ? 401 : 502 }
      );
    }

    const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!metaJson.url) {
      console.error("[media proxy] No URL in WhatsApp response for", mediaId, metaJson);
      return NextResponse.json({ error: "No download URL returned" }, { status: 502 });
    }

    // Step 2: Download actual media bytes
    const mediaRes = await fetch(metaJson.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "WAppHub/1.0",
      },
    });

    if (!mediaRes.ok) {
      console.error(`[media proxy] Download error ${mediaRes.status} for ${mediaId}`);
      return NextResponse.json({ error: `Download failed: ${mediaRes.status}` }, { status: 502 });
    }

    const buffer = await mediaRes.arrayBuffer();
    const contentType =
      metaJson.mime_type ??
      mediaRes.headers.get("content-type") ??
      "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Content-Length": buffer.byteLength.toString(),
      },
    });
  } catch (err) {
    console.error("[media proxy] Unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
