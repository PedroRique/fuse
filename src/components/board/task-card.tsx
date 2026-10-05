"use client";

import { memo, useEffect, type CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/clock";
import type { BoardPause, Task } from "@/domain/types";
import { getTaskTemporalState } from "@/domain/urgency";
import { formatCountdown } from "@/domain/time";
import { TaskCardFace, describeTemporal } from "./task-card-face";

export type CardMotion = "idle" | "leaving" | "exploding" | "flying";

type Props = {
  task: Task;
  pauses: readonly BoardPause[];
  x: number;
  y: number;
  maxScale: number;
  /** Rebuild view shrinks the whole world; drag deltas must be converted back. */
  zoom?: number;
  draggable?: boolean;
  motion?: CardMotion;
  pending?: boolean;
  onOpen?: (id: string) => void;
  onDue?: (id: string) => void;
  onKeyboardPlace?: (id: string) => void;
  /** Direction cards fly when the board explodes. */
  flyVector?: { x: number; y: number };
};

/**
 * A card on a canvas. Subscribes to the clock itself so only this card re-renders per tick.
 * Its saved position never changes because of growth: growth is a transform around the center.
 */
export const TaskCard = memo(function TaskCard({
  task,
  pauses,
  x,
  y,
  maxScale,
  zoom = 1,
  draggable = true,
  motion = "idle",
  pending = false,
  onOpen,
  onDue,
  onKeyboardPlace,
  flyVector,
}: Props) {
  const now = useNow();
  const temporal = getTaskTemporalState(task, pauses, now || Date.parse(task.fuseStartedAt));
  const due = now > 0 && task.status === "active" && temporal.state === "exploded";

  useEffect(() => {
    if (due) onDue?.(task.id);
  }, [due, onDue, task.id]);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable || pending,
  });

  const scale = Math.min(temporal.scale, maxScale);
  const dx = (transform?.x ?? 0) / zoom;
  const dy = (transform?.y ?? 0) / zoom;
  const z = isDragging ? 100_000 : 10 + Math.round(temporal.progress * 1000) + (task.explosionCount > 0 ? 1 : 0);

  const style: CSSProperties & Record<string, string | number> = {
    left: x,
    top: y,
    transform: `translate3d(${dx}px, ${dy}px, 0) translate(-50%, -50%) scale(${isDragging ? scale * 1.02 : scale})`,
    "--z": z,
    "--fly-x": `${flyVector?.x ?? 0}px`,
    "--fly-y": `${flyVector?.y ?? 0}px`,
  };

  const label = `${task.title}. ${describeTemporal(temporal, task)}. ${
    temporal.isFinalCountdown ? `${formatCountdown(temporal.remainingMs)} left.` : ""
  } ${task.explosionCount ? `Exploded ${task.explosionCount} time${task.explosionCount > 1 ? "s" : ""}.` : ""}`;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="task card"
      aria-label={label}
      data-testid="task-card"
      data-task-id={task.id}
      data-state={temporal.state}
      data-scar={task.explosionCount}
      onClick={() => onOpen?.(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (onKeyboardPlace) onKeyboardPlace(task.id);
          else onOpen?.(task.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      className={cn(
        "absolute z-(--z) origin-center cursor-grab touch-none outline-none select-none hover:z-[90000] focus-visible:z-[90000] active:cursor-grabbing",
        "focus-visible:[&>div]:ring-3 focus-visible:[&>div]:ring-stone-900/40",
        !isDragging && "transition-transform duration-700 ease-out motion-reduce:transition-none",
        pending && "opacity-60",
        motion === "leaving" && "pointer-events-none animate-[card-complete_450ms_ease-in_forwards] motion-reduce:animate-[fade-out_200ms_forwards]",
        motion === "exploding" && "pointer-events-none animate-[card-burst_700ms_ease-out_forwards] motion-reduce:animate-[fade-out_300ms_forwards]",
        motion === "flying" && "pointer-events-none animate-[card-fly_900ms_cubic-bezier(0.2,0.7,0.3,1)_forwards] motion-reduce:animate-[fade-out_300ms_forwards]",
      )}
      style={style}
    >
      <TaskCardFace task={task} temporal={temporal} animate={motion === "idle"} />
    </div>
  );
});
