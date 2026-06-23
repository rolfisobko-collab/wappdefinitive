import { NextResponse } from "next/server";
import { uploadImageToCloudinary, cloudinaryProductFolder } from "@/lib/cloudinary";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const folder = String(form.get("folder") || cloudinaryProductFolder());

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta archivo" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "La imagen supera 10MB" }, { status: 400 });
    }

    const upload = await uploadImageToCloudinary(file, folder);
    return NextResponse.json({
      ok: true,
      url: upload.secureUrl,
      publicId: upload.publicId,
      folder,
      format: upload.format,
      bytes: upload.bytes,
    });
  } catch (error) {
    console.error("[cloudinary upload]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al subir imagen" }, { status: 500 });
  }
}
