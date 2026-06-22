export const COLOR_ALIASES: Record<string, string[]> = {
  blanco: ["blanco", "blanca", "white"],
  negro: ["negro", "negra", "black"],
  rojo: ["rojo", "roja", "red"],
  azul: ["azul", "blue"],
  celeste: ["celeste"],
  rosa: ["rosa", "rosado", "rosada", "pink"],
  dorado: ["dorado", "dorada", "gold"],
  lila: ["lila", "violeta", "purpura", "púrpura", "purple"],
  verde: ["verde", "green"],
  gris: ["gris", "gray", "grey"],
  amarillo: ["amarillo", "amarilla", "yellow"],
  naranja: ["naranja", "orange"],
  plateado: ["plateado", "plateada", "silver"],
  grafito: ["grafito", "graphite"],
  beige: ["beige"],
};

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s/+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordIncludes(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(text);
}

export function normalizeProductColor(value: unknown): string | null {
  const text = norm(value);
  if (!text) return null;
  for (const [color, aliases] of Object.entries(COLOR_ALIASES)) {
    if (aliases.some((alias) => text === norm(alias))) return color;
  }
  return text.slice(0, 40);
}

export function detectProductColor(text: unknown): string | null {
  const normalized = ` ${norm(text)} `;
  if (!normalized.trim()) return null;
  for (const [color, aliases] of Object.entries(COLOR_ALIASES)) {
    if (aliases.some((alias) => wordIncludes(normalized, norm(alias)))) return color;
  }
  return null;
}

export function colorMatchesText(text: unknown, color: string | null): boolean {
  if (!color) return true;
  const normalized = ` ${norm(text)} `;
  const aliases = COLOR_ALIASES[color] ?? [color];
  return aliases.some((alias) => wordIncludes(normalized, norm(alias)));
}

export function colorLabel(color: string | null | undefined): string {
  if (!color) return "";
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export function uniqueColors(colors: Array<string | null | undefined>): string[] {
  return Array.from(new Set(colors.map(normalizeProductColor).filter(Boolean) as string[]));
}
