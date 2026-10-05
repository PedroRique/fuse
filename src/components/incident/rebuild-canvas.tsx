"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { TaskCard } from "@/components/board/task-card";
import { CameraHud, useCardSensors } from "@/components/board/board-canvas";
import { BOARD, STAGING_MARGIN, getNextFreeSlot, getStagingPositions, isInsideBoard } from "@/domain/board";
import type { BoardIncident, BoardPause, Task } from "@/domain/types";
import { restoreCard } from "@/server/actions";
import { useCamera } from "@/lib/use-camera";
import { cn } from "@/lib/utils";

const WORLD = { width: BOARD.width + STAGING_MARGIN * 2, height: BOARD.height + STAGING_MARGIN * 2 };

/**
 * Manual rebuild: every card waits in the staging ring and must be put back one by one.
 * There is deliberately no "restore all".
 */
export function RebuildCanvas({
  tasks,
  pauses,
  incident,
  onRestored,
  onChanged,
  onDue,
}: {
  tasks: Task[];
  pauses: readonly BoardPause[];
  incident: BoardIncident;
  onRestored: () => void;
  onChanged: () => void;
  onDue: (id: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const camera = useCamera(viewportRef, WORLD);
  const sensors = useCardSensors();
  const [requested, setRequested] = useState<Record<string, { x: number; y: number }>>({});

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const cards = useMemo(() => incident.tasks.filter((it) => byId.get(it.taskId)?.status === "active"), [incident.tasks, byId]);
  // A requested restore stops being "pending" once the server data shows it restored.
  const pending = Object.fromEntries(Object.entries(requested).filter(([id]) => !cards.find((c) => c.taskId === id)?.restoredAt));
  const staged = cards.filter((c) => !c.restoredAt && !pending[c.taskId]);
  const staging = useMemo(() => getStagingPositions(cards.map((c) => c.taskId)), [cards]);
  const restoredCount = cards.length - staged.length - Object.keys(pending).length;

  const place = useCallback(
    async (id: string, x: number, y: number) => {
      setRequested((p) => ({ ...p, [id]: { x, y } }));
      const res = await restoreCard({ taskId: id, x: Math.round(x), y: Math.round(y) });
      if (!res.ok) {
        setRequested((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
        toast.error("Couldn't put that card back.", { description: res.error });
        onChanged();
        return;
      }
      if (res.data?.resolved) onRestored();
      else onChanged();
    },
    [onChanged, onRestored],
  );

  function positionOf(id: string, restoredAt: string | null) {
    const t = byId.get(id)!;
    if (pending[id]) return pending[id];
    if (restoredAt) return { x: t.positionX, y: t.positionY };
    return staging[id];
  }

  function handleDragEnd(e: DragEndEvent) {
    if (camera.gestureRef.current) return;
    const id = String(e.active.id);
    const c = cards.find((x) => x.taskId === id);
    if (!c || c.restoredAt || pending[id]) return;
    const from = positionOf(id, null);
    const z = camera.cameraRef.current.zoom;
    const x = from.x + e.delta.x / z;
    const y = from.y + e.delta.y / z;
    if (isInsideBoard(x, y)) void place(id, x, y);
  }

  function keyboardPlace(id: string) {
    const occupied = cards.filter((c) => c.restoredAt || pending[c.taskId]).map((c) => positionOf(c.taskId, c.restoredAt));
    const slot = getNextFreeSlot(occupied);
    void place(id, slot.x, slot.y);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b px-6 py-4">
        <div>
          <h2 className="text-xl font-bold tracking-[0.2em]">REBUILD YOUR BOARD</h2>
          <p className="text-sm text-muted-foreground">
            You broke it. Put it back together. Drag each card onto the board, or focus it and press Enter.
          </p>
        </div>
        <p className="font-mono text-lg font-semibold tabular-nums" aria-live="polite" data-testid="rebuild-progress">
          {restoredCount} / {cards.length} restored
        </p>
      </div>

      <div
        ref={viewportRef}
        className={cn("relative min-h-0 flex-1 touch-none overflow-hidden overscroll-none bg-stone-100", camera.panning ? "cursor-grabbing" : "cursor-grab")}
        role="region"
        aria-label="Rebuild area. Scroll to pan, pinch or ctrl-scroll to zoom."
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
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="absolute top-0 left-0 origin-top-left" style={{ width: WORLD.width, height: WORLD.height, transform: camera.transform }}>
            <div
              className="board-grid absolute rounded-2xl border-2 border-dashed border-stone-400 bg-background"
              style={{ left: STAGING_MARGIN, top: STAGING_MARGIN, width: BOARD.width, height: BOARD.height }}
              data-testid="rebuild-dropzone"
            >
              {restoredCount === 0 && (
                <p className="absolute inset-0 flex items-center justify-center text-4xl font-semibold tracking-[0.3em] text-stone-300">
                  YOUR BOARD
                </p>
              )}
            </div>
            <div className="absolute" style={{ left: STAGING_MARGIN, top: STAGING_MARGIN }}>
              {cards.map((c) => {
                const t = byId.get(c.taskId)!;
                const p = positionOf(c.taskId, c.restoredAt);
                const movable = !c.restoredAt && !pending[c.taskId];
                return (
                  <TaskCard
                    key={c.taskId}
                    task={t}
                    pauses={pauses}
                    x={p.x}
                    y={p.y}
                    zoom={camera.camera.zoom}
                    maxScale={1.6}
                    draggable={movable}
                    pending={!!pending[c.taskId]}
                    onDue={onDue}
                    onKeyboardPlace={movable ? keyboardPlace : undefined}
                  />
                );
              })}
            </div>
          </div>
        </DndContext>
        <CameraHud zoom={camera.camera.zoom} onFit={camera.fit} onZoomIn={camera.zoomIn} onZoomOut={camera.zoomOut} />
      </div>
    </div>
  );
}
