import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMessageTime(date: Date): string {
  return format(date, "HH:mm");
}

export function formatConversationTime(date: Date | null): string {
  if (!date) return "";
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Ayer";
  return format(date, "dd/MM/yy");
}

export function formatRelativeTime(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true, locale: es });
}

export function getInitials(name: string | null, phone: string): string {
  if (name) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }
  return phone.slice(-2);
}

export function formatPhone(phone: string): string {
  // Basic international format
  if (phone.startsWith("549")) {
    const local = phone.slice(3);
    return `+54 9 ${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return `+${phone}`;
}

export function formatCurrency(amount: number, currency: string = "ARS"): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}
