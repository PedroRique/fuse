import { cn } from "@/lib/utils";
import type { Impact } from "@/domain/types";

export const IMPACT_LABEL: Record<Impact, string> = {
  low: "Low impact",
  normal: "Normal impact",
  high: "High impact",
  critical: "Critical impact",
};

/** Distinct hue per impact so criticidade is readable at a glance. Fuse heat stays on the card body. */
export const IMPACT_TONE: Record<Impact, { text: string; bar: string; rest: string }> = {
  low: { text: "text-sky-800", bar: "bg-sky-500", rest: "bg-sky-200" },
  normal: { text: "text-violet-800", bar: "bg-violet-500", rest: "bg-violet-200" },
  high: { text: "text-amber-800", bar: "bg-amber-500", rest: "bg-amber-200" },
  critical: { text: "text-rose-800", bar: "bg-rose-600", rest: "bg-rose-200" },
};

export function ImpactBadge({ impact, className }: { impact: Impact; className?: string }) {
  const bars = { low: 1, normal: 2, high: 3, critical: 4 }[impact];
  const tone = IMPACT_TONE[impact];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", tone.text, className)}>
      <span aria-hidden className="flex items-end gap-[2px]">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("w-[3px] rounded-[1px]", i <= bars ? tone.bar : tone.rest)}
            style={{ height: 4 + i * 2 }}
          />
        ))}
      </span>
      {IMPACT_LABEL[impact]}
    </span>
  );
}

export const IMPACT_EDGE: Record<Impact, string> = {
  low: "border-l-[4px] border-l-sky-400",
  normal: "border-l-[4px] border-l-violet-500",
  high: "border-l-[5px] border-l-amber-500",
  critical: "border-l-[7px] border-l-rose-600",
};
