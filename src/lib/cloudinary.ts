import crypto from "crypto";

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
  format: string;
  bytes: number;
};

const DEFAULT_PRODUCT_FOLDER = "clientes/alta-telefonia/productos";

function cloudinaryConfig(): CloudinaryConfig {
  const url = process.env.CLOUDINARY_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      cloudName: parsed.hostname,
      apiKey: decodeURIComponent(parsed.username),
      apiSecret: decodeURIComponent(parsed.password),
    };
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary no esta configurado");
  }
  return { cloudName, apiKey, apiSecret };
}

function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== "" && value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

export function cloudinaryProductFolder(): string {
  return process.env.CLOUDINARY_PRODUCT_FOLDER || DEFAULT_PRODUCT_FOLDER;
}

export async function uploadImageToCloudinary(file: File, folder = cloudinaryProductFolder()): Promise<CloudinaryUploadResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error("El archivo no es una imagen");
  }

  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder,
    timestamp,
    overwrite: "false",
  };

  const form = new FormData();
  form.set("file", file);
  form.set("api_key", apiKey);
  form.set("timestamp", String(timestamp));
  form.set("folder", folder);
  form.set("overwrite", "false");
  form.set("signature", signParams(params, apiSecret));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "No se pudo subir la imagen");
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
    format: data.format,
    bytes: data.bytes,
  };
}

export async function uploadImageBytesToCloudinary(
  bytes: Buffer | ArrayBuffer,
  mime: string,
  filename = "whatsapp-image",
  folder = "clientes/alta-telefonia/whatsapp"
): Promise<CloudinaryUploadResult> {
  const file = new File([bytes], filename, { type: mime || "image/jpeg" });
  return uploadImageToCloudinary(file, folder);
}
