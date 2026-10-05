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
  return (
    <div
      className="relative h-1 w-full rounded-full bg-stone-900/6"
      role="progressbar"
      aria-label="Fuse burned"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-linear",
          state === "critical" ? "bg-red-700" : hot ? "bg-orange-600" : state === "active" ? "bg-stone-600" : "bg-stone-400",
        )}
        style={{ width: `${remaining * 100}%` }}
      />
      {hot && remaining > 0 && (
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
            state === "critical" ? "bg-amber-300 shadow-[0_0_8px_2px_rgba(251,146,60,0.9)]" : "bg-amber-200 shadow-[0_0_5px_1px_rgba(251,146,60,0.6)]",
            animate && "motion-safe:animate-[spark_0.9s_ease-in-out_infinite]",
          )}
          style={{ left: `${remaining * 100}%` }}
        />
      )}
    </div>
  );
}
