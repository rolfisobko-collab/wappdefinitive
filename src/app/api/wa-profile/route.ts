import { NextResponse } from "next/server";
import { getWAConfig } from "@/lib/db";
import axios from "axios";

const WA_API = "https://graph.facebook.com/v19.0";

async function getCredentials() {
  const cfg = await getWAConfig() as Record<string, string> | null;
  if (!cfg?.phoneNumberId || !cfg?.accessToken)
    throw new Error("WhatsApp no configurado");
  return { phoneNumberId: cfg.phoneNumberId, token: cfg.accessToken };
}

export async function GET() {
  try {
    const { phoneNumberId, token } = await getCredentials();
    const { data } = await axios.get(
      `${WA_API}/${phoneNumberId}/whatsapp_business_profile`,
      {
        params: { fields: "about,address,description,email,profile_picture_url,websites,vertical" },
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return NextResponse.json(data);
  } catch (error) {
    console.error("[wa-profile GET]", error);
    return NextResponse.json({ error: "Error al obtener perfil" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { phoneNumberId, token } = await getCredentials();
    const body = await req.json();

    // Only send allowed profile fields
    const payload: Record<string, unknown> = {};
    if (body.about       !== undefined) payload.about       = body.about;
    if (body.address     !== undefined) payload.address     = body.address;
    if (body.description !== undefined) payload.description = body.description;
    if (body.email       !== undefined) payload.email       = body.email;
    if (body.websites    !== undefined) payload.websites    = body.websites;

    // Profile picture: if URL provided, fetch and upload as media first
    if (body.profilePictureUrl) {
      try {
        const imgRes  = await axios.get(body.profilePictureUrl, { responseType: "arraybuffer" });
        const buffer  = Buffer.from(imgRes.data);
        const mime    = imgRes.headers["content-type"] ?? "image/jpeg";

        const FormData = (await import("form-data")).default;
        const form     = new FormData();
        form.append("file", buffer, { filename: "profile.jpg", contentType: mime });
        form.append("type", mime);
        form.append("messaging_product", "whatsapp");

        const uploadRes = await axios.post(
          `${WA_API}/${phoneNumberId}/media`,
          form,
          { headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` } }
        );
        payload.profile_picture_handle = uploadRes.data.h;
      } catch (e) {
        console.warn("[wa-profile] No se pudo subir la foto:", e);
      }
    }

    await axios.post(
      `${WA_API}/${phoneNumberId}/whatsapp_business_profile`,
      payload,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[wa-profile PUT]", error);
    return NextResponse.json({ error: "Error al actualizar perfil" }, { status: 500 });
  }
}
