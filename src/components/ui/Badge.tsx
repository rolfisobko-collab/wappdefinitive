import { cn } from "@/lib/utils";

interface BadgeProps {
  count: number;
  className?: string;
}

export function Badge({ count, className }: BadgeProps) {
  if (count === 0) return null;
  return (
    <span className={cn(
      "min-w-[19px] h-[19px] px-1 rounded-full text-[11px] font-bold",
      "flex items-center justify-center bg-[#25d366] text-white",
      className
    )}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
