import { NextRequest, NextResponse } from "next/server";
import { getWAConfig } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { mediaId: string } }
) {
  try {
    const { mediaId } = params;
    const waConfig = (await getWAConfig()) as Record<string, string> | null;
    const token = waConfig?.accessToken;
    if (!token) {
      return NextResponse.json({ error: "No configured" }, { status: 503 });
    }

    // Step 1: Get media URL from WhatsApp
    const metaRes = await fetch(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!metaRes.ok) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }
    const metaJson = await metaRes.json() as { url?: string; mime_type?: string };
    if (!metaJson.url) {
      return NextResponse.json({ error: "No URL" }, { status: 404 });
    }

    // Step 2: Download actual media
    const mediaRes = await fetch(metaJson.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!mediaRes.ok) {
      return NextResponse.json({ error: "Download failed" }, { status: 502 });
    }

    const buffer = await mediaRes.arrayBuffer();
    const contentType = metaJson.mime_type ?? mediaRes.headers.get("content-type") ?? "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    console.error("[media proxy]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
