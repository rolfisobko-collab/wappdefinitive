export const dynamic = "force-static";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <rect width="1200" height="1200" fill="#f3f7f5"/>
  <rect x="240" y="280" width="720" height="520" rx="36" fill="#ffffff" stroke="#0b8063" stroke-width="18"/>
  <path d="M390 650l135-140 105 115 85-75 125 140" fill="none" stroke="#0b8063" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="780" cy="430" r="50" fill="#0b8063"/>
  <text x="600" y="905" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="700" fill="#123b32">Alta Telefonia</text>
  <text x="600" y="980" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" fill="#537269">Producto sin imagen</text>
</svg>`;

export async function GET() {
  return new Response(SVG, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
