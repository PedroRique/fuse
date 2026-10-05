import { format } from "date-fns";
import { AlarmClock, Check, Flame, Moon, Pause, TriangleAlert, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/domain/types";
import type { TaskTemporalState } from "@/domain/urgency";
import { getScarLevel, showsExplosionCounter } from "@/domain/scars";
import { formatCountdown, formatDuration } from "@/domain/time";
import { CARD } from "@/domain/board";
import { FuseIndicator } from "./fuse-indicator";
import { IMPACT_EDGE, ImpactBadge } from "./impact-badge";
import { SCAR_CLIP, TaskScarOverlay } from "./task-scar-overlay";

const STATE_META = {
  safe: { label: "On track", Icon: Wind },
  active: { label: "Heating up", Icon: AlarmClock },
  warning: { label: "Warning", Icon: TriangleAlert },
  critical: { label: "Critical", Icon: Flame },
  exploded: { label: "Exploded", Icon: Flame },
} as const;

export function describeTemporal(t: TaskTemporalState, task: Pick<Task, "botherAfter" | "status">) {
  if (task.status === "completed") return "Done";
  if (t.isPaused) return "Paused";
  if (t.isDormant && task.botherAfter) return `Quiet until ${format(new Date(task.botherAfter), "EEE HH:mm")}`;
  return STATE_META[t.state].label;
}

/** Pure visual of a task. Size is applied by the parent via transform. */
export function TaskCardFace({
  task,
  temporal,
  animate = true,
  className,
}: {
  task: Task;
  temporal: TaskTemporalState;
  animate?: boolean;
  className?: string;
}) {
  const scar = getScarLevel(task.explosionCount);
  const { state, heat, isDormant, isFinalCountdown, isPaused } = temporal;
  const done = task.status === "completed";
  const { Icon } = done
    ? { Icon: Check }
    : isPaused
      ? { Icon: Pause }
      : isDormant
        ? { Icon: Moon }
        : STATE_META[state];
  const motion = animate && !isPaused && !done;

  // Temperature: white → warm → hot. Mix is linear with burned %, so 20% already reads warmer than 5%.
  const tint = isDormant || done ? 0 : Math.round(heat * 42);
  const tintColor = state === "critical" || state === "exploded" ? "#dc2626" : "#ea580c";

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-white p-3 text-left text-stone-900 shadow-sm",
        done
          ? "border-emerald-200 bg-emerald-50/90"
          : state === "critical" && !isDormant
            ? "border-red-400"
            : state === "warning" && !isDormant
              ? "border-orange-300"
              : state === "active" && !isDormant
                ? "border-orange-200"
                : "border-stone-200",
        state === "critical" && !isDormant && motion && "motion-safe:animate-[fuse-pulse_1.8s_ease-in-out_infinite]",
        scar >= 3 && !done && "border-stone-400",
        done ? "border-l-[4px] border-l-emerald-500" : IMPACT_EDGE[task.impact],
        className,
      )}
      style={{
        width: CARD.width,
        minHeight: CARD.height,
        clipPath: SCAR_CLIP[scar],
        backgroundColor: tint ? `color-mix(in oklch, white, ${tintColor} ${tint}%)` : undefined,
      }}
    >
      <TaskScarOverlay level={scar} />

      <div className="relative flex items-center justify-between gap-2 text-[11px] font-medium tracking-wide whitespace-nowrap uppercase">
        <span
          className={cn(
            "inline-flex items-center gap-1",
            done ? "text-emerald-800" : state === "critical" && !isDormant ? "text-red-800" : state === "warning" && !isDormant ? "text-orange-800" : "text-stone-500",
          )}
        >
          <Icon className="size-3" aria-hidden />
          {describeTemporal(temporal, task)}
        </span>
        {done ? (
          <span className="text-emerald-700/80 normal-case tabular-nums">Fuse out</span>
        ) : showsExplosionCounter(task.explosionCount) ? (
          <span className="rounded-full bg-stone-900 px-1.5 py-0.5 text-[10px] text-white normal-case" title={`Exploded ${task.explosionCount} times`}>
            💥 ×{task.explosionCount}
          </span>
        ) : (
          !isFinalCountdown && state !== "exploded" && (
            <span className="text-stone-500 normal-case tabular-nums">{formatDuration(temporal.remainingMs)} left</span>
          )
        )}
      </div>

      <p className={cn("relative line-clamp-3 text-[15px] leading-snug font-medium text-balance", state === "critical" && !done && "font-semibold", done && "text-stone-700")}>
        {task.title}
      </p>

      {isFinalCountdown && !isDormant && !done && (
        <p
          className="relative font-mono text-2xl font-bold tracking-tight text-red-800 tabular-nums"
          aria-label={`${formatCountdown(temporal.remainingMs)} remaining`}
        >
          {formatCountdown(temporal.remainingMs)}
        </p>
      )}

      <div className="relative mt-auto flex flex-col gap-2">
        {done ? (
          <div className="h-1.5 w-full rounded-full bg-emerald-200" aria-hidden />
        ) : (
          <FuseIndicator progress={temporal.progress} state={isDormant ? "safe" : state} animate={motion} />
        )}
        <ImpactBadge impact={task.impact} className={done ? "opacity-70" : undefined} />
      </div>
    </div>
  );
}
