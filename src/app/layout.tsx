import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WApp Business Hub",
  description: "Plataforma de automatización WhatsApp Business con IA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
