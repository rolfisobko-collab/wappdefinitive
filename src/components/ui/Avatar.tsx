"use client";

import { getInitials } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface AvatarProps {
  name: string | null;
  phone: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-base",
};

const colorMap = [
  "bg-[#06cf9c]", "bg-[#0074d9]", "bg-[#9b59b6]", "bg-[#e74c3c]",
  "bg-[#e67e22]", "bg-[#1abc9c]", "bg-[#3498db]", "bg-[#8e44ad]",
];

function getColorFromPhone(phone: string): string {
  const sum = phone.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colorMap[sum % colorMap.length];
}

export function Avatar({ name, phone, src, size = "md", className }: AvatarProps) {
  const initials = getInitials(name, phone);
  const bgColor = getColorFromPhone(phone);

  if (src) {
    return (
      <img
        src={src}
        alt={name ?? phone}
        className={cn("rounded-full object-cover flex-shrink-0", sizeMap[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0",
        bgColor, sizeMap[size], className
      )}
    >
      {initials}
    </div>
  );
}
