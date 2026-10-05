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
import { LocateFixed, Minus, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOARD, CARD, clampToBoard } from "@/domain/board";
import { URGENCY } from "@/domain/urgency";
import type { BoardPause, Task } from "@/domain/types";
import { useCamera } from "@/lib/use-camera";
import { Button } from "@/components/ui/button";
import { TaskCard, type CardMotion } from "./task-card";
import { Input } from "@/components/ui/input";
import { findTasks } from "@/domain/search";

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
  onMove: (id: string, x: number, y: number, sizes: Record<string, { width: number; height: number }>) => void;
  onOpen: (id: string) => void;
  onDue: (id: string) => void;
  empty: React.ReactNode;
};

export function BoardCanvas({ tasks, pauses, positions, motions, paused, shaking, interactive, onMove, onOpen, onDue, empty }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const maxScale = useMaxScale(viewportRef);
  const sensors = useCardSensors();
  const lastDragEnd = useRef(0);
  const camera = useCamera(viewportRef, BOARD, true);
  const [query, setQuery] = useState("");
  const [foundId, setFoundId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const matches = findTasks(tasks, query);
  const locate = (id: string) => {
    camera.focusCard(id);
    setFoundId(id);
    setSearchOpen(false);
  };

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      if (camera.gestureRef.current) return;
      lastDragEnd.current = Date.now();
      const id = String(e.active.id);
      const from = positions[id];
      if (!from || (e.delta.x === 0 && e.delta.y === 0)) return;
      const z = camera.cameraRef.current.zoom;
      const to = clampToBoard(from.x + e.delta.x / z, from.y + e.delta.y / z);
      const sizes: Record<string, { width: number; height: number }> = {};
      viewportRef.current?.querySelectorAll<HTMLElement>("[data-task-id]").forEach((card) => {
        const rect = card.getBoundingClientRect();
        sizes[card.dataset.taskId!] = { width: rect.width / z, height: rect.height / z };
      });
      onMove(id, to.x, to.y, sizes);
    },
    [positions, onMove, camera.cameraRef, camera.gestureRef],
  );

  const handleOpen = useCallback(
    (id: string) => {
      if (Date.now() - lastDragEnd.current < 250) return;
      onOpen(id);
    },
    [onOpen],
  );

  return (
    <div className="relative isolate z-0 flex min-h-0 flex-1 flex-col">
      <div className="relative z-20 border-b bg-background px-3 py-2">
        <form className="mx-auto flex max-w-xl items-center gap-2" role="search" onSubmit={(e) => { e.preventDefault(); if (matches.length) locate(matches[0].id); }}>
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Find a task by title" placeholder="Find a task by title…" value={query}
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setFoundId(null); }}
            onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }} />
          {query && <Button type="button" variant="ghost" size="icon" aria-label="Clear task search" onClick={() => { setQuery(""); setFoundId(null); setSearchOpen(false); }}><X /></Button>}
        </form>
        {query.trim() && searchOpen && (
          <div className="absolute inset-x-3 top-full mx-auto max-h-[40dvh] max-w-xl overflow-y-auto rounded-b-lg border bg-popover p-2 shadow-lg">
            <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{matches.length ? `${matches.length} task${matches.length === 1 ? "" : "s"} found` : "No tasks found."}</p>
            <ul>
              {matches.map((task) => <li key={task.id} className="flex items-center gap-2 border-b px-2 py-2 last:border-0">
                <span className="min-w-0 flex-1 break-words text-sm">{task.title}{task.status === "completed" && <span className="ml-2 text-xs text-muted-foreground">Done</span>}</span>
                <Button type="button" variant="outline" size="sm" aria-label={`Center task: ${task.title}`} onClick={() => locate(task.id)}><LocateFixed aria-hidden /> Center</Button>
              </li>)}
            </ul>
          </div>
        )}
      </div>
      {tasks.length === 0 && empty}
      <div
        ref={viewportRef}
        className={cn(
          "relative isolate min-h-0 flex-1 touch-none overflow-hidden overscroll-none",
          paused && "board-paused",
          camera.panning ? "cursor-grabbing" : "cursor-grab",
        )}
        aria-label="Task board. Scroll to pan, pinch or ctrl-scroll to zoom, drag empty space to pan."
        role="region"
        onPointerDown={camera.onPointerDown}
        onPointerMove={camera.onPointerMove}
        onPointerUp={camera.onPointerUp}
        onPointerCancel={camera.onPointerUp}
        onPointerDownCapture={camera.onPointerDownCapture}
        onPointerMoveCapture={camera.onPointerMoveCapture}
        onPointerUpCapture={camera.onPointerUpCapture}
        onPointerCancelCapture={camera.onPointerUpCapture}
        onClickCapture={camera.onClickCapture}
      >
        <DndContext sensors={sensors} onDragEnd={handleDragEnd} accessibility={{ screenReaderInstructions: { draggable: "Press space to pick up a card, use the arrow keys to move it, and space again to drop it. Press enter to open it." } }}>
          <div
            className={cn("board-grid absolute top-0 left-0 origin-top-left", shaking && "board-shake animate-[board-shake_550ms_ease-in-out]")}
            style={{ width: BOARD.width, height: BOARD.height, transform: camera.transform }}
          >
            {tasks.map((t) => {
              const p = positions[t.id] ?? { x: t.positionX, y: t.positionY };
              const motion = motions[t.id] ?? "idle";
              return (
                <TaskCard
                  key={t.id}
                  task={t}
                  highlighted={t.id === foundId}
                  pauses={pauses}
                  x={p.x}
                  y={p.y}
                  zoom={camera.camera.zoom}
                  maxScale={maxScale}
                  bounds={BOARD}
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
        <CameraHud zoom={camera.camera.zoom} onFit={camera.fit} onZoomIn={camera.zoomIn} onZoomOut={camera.zoomOut} />
      </div>
    </div>
  );
}

export function CameraHud({
  zoom,
  onFit,
  onZoomIn,
  onZoomOut,
}: {
  zoom: number;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div
      data-camera-hud
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute right-3 bottom-3 z-[200] flex items-center gap-0.5 rounded-lg border bg-background/95 p-0.5 shadow-sm"
    >
      <Button type="button" variant="ghost" size="icon-xs" onClick={onZoomOut} aria-label="Zoom out">
        <Minus />
      </Button>
      <button
        type="button"
        onClick={onFit}
        className="min-w-12 px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
        aria-label="Fit board to view"
        title="Fit"
      >
        {Math.round(zoom * 100)}%
      </button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={onZoomIn} aria-label="Zoom in">
        <Plus />
      </Button>
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
