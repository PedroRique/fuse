"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { BOARD, CARD, clampToBoard } from "@/domain/board";
import { URGENCY } from "@/domain/urgency";
import type { BoardPause, Task } from "@/domain/types";
import { TaskCard, type CardMotion } from "./task-card";

/** A card may grow until it covers most of the viewport, never all of it. */
export function useMaxScale(ref: React.RefObject<HTMLElement | null>) {
  const [maxScale, setMaxScale] = useState<number>(URGENCY.maxScale);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setMaxScale(Math.max(1.2, Math.min(URGENCY.maxScale, (0.9 * width) / CARD.width, (0.75 * height) / CARD.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return maxScale;
}

export function useCardSensors(keyboard = true) {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: keyboard ? { start: ["Space"], cancel: ["Escape"], end: ["Space"] } : { start: [], cancel: [], end: [] },
    }),
  );
}

type Props = {
  tasks: Task[];
  pauses: readonly BoardPause[];
  positions: Record<string, { x: number; y: number }>;
  motions: Record<string, CardMotion>;
  paused: boolean;
  shaking: boolean;
  interactive: boolean;
  onMove: (id: string, x: number, y: number) => void;
  onOpen: (id: string) => void;
  onDue: (id: string) => void;
  empty: React.ReactNode;
};

export function BoardCanvas({ tasks, pauses, positions, motions, paused, shaking, interactive, onMove, onOpen, onDue, empty }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const maxScale = useMaxScale(viewportRef);
  const sensors = useCardSensors();
  const lastDragEnd = useRef(0);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      lastDragEnd.current = Date.now();
      const id = String(e.active.id);
      const from = positions[id];
      if (!from || (e.delta.x === 0 && e.delta.y === 0)) return;
      const to = clampToBoard(from.x + e.delta.x, from.y + e.delta.y);
      onMove(id, to.x, to.y);
    },
    [positions, onMove],
  );

  const handleOpen = useCallback(
    (id: string) => {
      if (Date.now() - lastDragEnd.current < 250) return;
      onOpen(id);
    },
    [onOpen],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    {tasks.length === 0 && empty}
    <div
      ref={viewportRef}
      className={cn("relative min-h-0 flex-1 overflow-auto overscroll-contain", paused && "board-paused")}
      aria-label="Task board"
      role="region"
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd} accessibility={{ screenReaderInstructions: { draggable: "Press space to pick up a card, use the arrow keys to move it, and space again to drop it. Press enter to open it." } }}>
        <div
          className={cn("board-grid relative", shaking && "board-shake animate-[board-shake_550ms_ease-in-out]")}
          style={{ width: BOARD.width, height: BOARD.height }}
        >
          {tasks.map((t) => {
            const p = positions[t.id] ?? { x: t.positionX, y: t.positionY };
            const motion = motions[t.id] ?? "idle";
            return (
              <TaskCard
                key={t.id}
                task={t}
                pauses={pauses}
                x={p.x}
                y={p.y}
                maxScale={maxScale}
                draggable={interactive}
                motion={motion}
                flyVector={motion === "flying" ? flyVector(p.x, p.y) : undefined}
                onOpen={interactive ? handleOpen : undefined}
                onDue={onDue}
              />
            );
          })}
        </div>
      </DndContext>
    </div>
    </div>
  );
}

/** Pushes a card away from the board center, far enough to leave the viewport. */
function flyVector(x: number, y: number) {
  const dx = x - BOARD.width / 2;
  const dy = y - BOARD.height / 2;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (dx / len) * 1400, y: (dy / len) * 1000 };
}
