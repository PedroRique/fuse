import { cn } from "@/lib/utils";
import type { Impact } from "@/domain/types";

export const IMPACT_LABEL: Record<Impact, string> = {
  low: "Low impact",
  normal: "Normal impact",
  high: "High impact",
  critical: "Critical impact",
};

/**
 * Impact uses weight (bars), never size or warm color: those channels belong to urgency.
 */
export function ImpactBadge({ impact, className }: { impact: Impact; className?: string }) {
  const bars = { low: 1, normal: 2, high: 3, critical: 4 }[impact];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-600", className)}>
      <span aria-hidden className="flex items-end gap-[2px]">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("w-[3px] rounded-[1px]", i <= bars ? "bg-stone-800" : "bg-stone-300")}
            style={{ height: 4 + i * 2 }}
          />
        ))}
      </span>
      {IMPACT_LABEL[impact]}
    </span>
  );
}

/** Left edge of the card: thicker and darker as impact rises. */
export const IMPACT_EDGE: Record<Impact, string> = {
  low: "border-l-[3px] border-l-stone-300",
  normal: "border-l-[3px] border-l-stone-500",
  high: "border-l-[5px] border-l-stone-800",
  critical: "border-l-[7px] border-l-stone-950",
};
