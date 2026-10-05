import { cn } from "@/lib/utils";
import type { TemporalStateName } from "@/domain/urgency";

/** Remaining fuse as a burning line; the spark appears once the fuse gets short. */
export function FuseIndicator({
  progress,
  state,
  animate,
}: {
  progress: number;
  state: TemporalStateName;
  animate: boolean;
}) {
  const remaining = Math.max(0, 1 - progress);
  const hot = state === "warning" || state === "critical";
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-1.5 min-w-0 flex-1 rounded-full bg-stone-900/10"
        role="progressbar"
        aria-label="Fuse burned"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-linear",
            state === "critical"
              ? "bg-red-700"
              : hot
                ? "bg-orange-500"
                : state === "active"
                  ? "bg-orange-400"
                  : "bg-stone-500",
          )}
          style={{ width: `${remaining * 100}%` }}
        />
        {remaining > 0 && remaining < 1 && (
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
              hot
                ? state === "critical"
                  ? "bg-amber-300 shadow-[0_0_8px_2px_rgba(251,146,60,0.9)]"
                  : "bg-amber-200 shadow-[0_0_5px_1px_rgba(251,146,60,0.6)]"
                : "bg-stone-400",
              hot && animate && "motion-safe:animate-[spark_0.9s_ease-in-out_infinite]",
            )}
            style={{ left: `${remaining * 100}%` }}
          />
        )}
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-stone-500 tabular-nums">{pct}%</span>
    </div>
  );
}
