"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/app-header";
import { BoardCanvas } from "./board-canvas";
import { PauseBanner } from "./pause-banner";
import type { CardMotion } from "./task-card";
import { CreateTaskDialog } from "@/components/dialogs/create-task-dialog";
import { TaskDetailsDialog } from "@/components/dialogs/task-details-dialog";
import { CutWireDialog } from "@/components/dialogs/cut-wire-dialog";
import { EmergencyPauseDialog } from "@/components/dialogs/emergency-pause-dialog";
import { ExplosionOverlay } from "@/components/incident/explosion-overlay";
import { RebuildCanvas } from "@/components/incident/rebuild-canvas";
import { TimeTravelPanel } from "@/components/dev/time-travel-panel";
import { getNow, syncServerClock, useClockValue, useHydrated } from "@/lib/clock";
import { useOnline, useReducedMotion } from "@/lib/use-online";
import { getActivePause, getRemainingMs } from "@/domain/time";
import { getNewTaskPosition } from "@/domain/board";
import { packCards, readingOrder, sortTasks, type BoardSort } from "@/domain/layout";
import { getTaskTemporalState } from "@/domain/urgency";
import type { BoardSnapshot } from "@/server/queries";
import { moveTask, syncBoard } from "@/server/actions";
import type { Task } from "@/domain/types";

export function BoardApp({ snapshot }: { snapshot: BoardSnapshot }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const online = useOnline();
  const reducedMotion = useReducedMotion();
  const mounted = useHydrated();

  const { tasks, pauses, incident, events } = snapshot;
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  useEffect(() => syncServerClock(snapshot.serverNow), [snapshot.serverNow]);

  const [createOpen, setCreateOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [cutWire, setCutWire] = useState<{ id: string; desiredEnd?: Date } | null>(null);
  const [restored, setRestored] = useState(false);

  // Timestamps are the truth; timers only repaint. Coming back to the tab re-syncs with the server.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [refresh]);

  const syncing = useRef(false);
  const onDue = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    await syncBoard();
    syncing.current = false;
    refresh();
  }, [refresh]);

  // --- explosion sequence (only when it happens live; a refresh lands directly on the overlay) ---
  const prevPhase = useRef<string | null | undefined>(undefined);
  const [exploding, setExploding] = useState<{ ids: Set<string> } | null>(null);
  useEffect(() => {
    const phase = incident?.phase ?? null;
    const wasLoaded = prevPhase.current !== undefined;
    if (wasLoaded && phase === "post_mortem" && prevPhase.current !== "post_mortem") {
      const ids = new Set(incident!.tasks.filter((t) => t.exploded && !t.postMortemDone).map((t) => t.taskId));
      setExploding({ ids });
      const timer = setTimeout(() => setExploding(null), reducedMotion ? 450 : 1500);
      prevPhase.current = phase;
      return () => clearTimeout(timer);
    }
    prevPhase.current = phase;
  }, [incident, reducedMotion]);

  // --- positions: optimistic for plain moves; an incident invalidates them (cards get rebuilt) ---
  const incidentKey = incident?.id ?? null;
  const [moved, setMoved] = useState<{ key: string | null; map: Record<string, { x: number; y: number }> }>({ key: null, map: {} });
  const positions = useMemo(() => {
    const overrides = moved.key === incidentKey ? moved.map : {};
    return Object.fromEntries(tasks.map((t) => [t.id, overrides[t.id] ?? { x: t.positionX, y: t.positionY }]));
  }, [tasks, moved, incidentKey]);
  const onMove = useCallback(
    async (id: string, x: number, y: number) => {
      setMoved((m) => ({ key: incidentKey, map: { ...(m.key === incidentKey ? m.map : {}), [id]: { x, y } } }));
      const res = await moveTask({ taskId: id, x, y });
      if (!res.ok) {
        setMoved((m) => {
          const map = { ...m.map };
          delete map[id];
          return { ...m, map };
        });
        toast.error("Couldn't move that card.", { description: res.error });
      }
    },
    [incidentKey],
  );

  const layoutTasks = useCallback(
    async (ordered: Task[]) => {
      if (!ordered.length) return;
      const now = getNow();
      const next = packCards(ordered.map((t) => ({ id: t.id, scale: getTaskTemporalState(t, pauses, now).scale })));
      setMoved({ key: incidentKey, map: next });
      const results = await Promise.all(Object.entries(next).map(([id, p]) => moveTask({ taskId: id, x: p.x, y: p.y })));
      const fail = results.find((r) => !r.ok);
      if (fail && !fail.ok) {
        toast.error("Couldn't rearrange the board.", { description: fail.error });
        refresh();
      }
    },
    [pauses, incidentKey, refresh],
  );

  // --- completion: animate only after the server confirmed ---
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const onCompleted = useCallback(
    (id: string) => {
      setDetailsId(null);
      setLeaving((s) => new Set(s).add(id));
      const t = tasks.find((x) => x.id === id);
      toast.success("Done.", { description: t?.explosionCount ? `Completed after ${t.explosionCount} explosion${t.explosionCount > 1 ? "s" : ""}. The scars stay in your history.` : t?.title });
      setTimeout(refresh, 450);
    },
    [tasks, refresh],
  );

  const motions = useMemo(() => {
    const m: Record<string, CardMotion> = {};
    for (const id of leaving) m[id] = "leaving";
    if (exploding) for (const t of tasks) m[t.id] = exploding.ids.has(t.id) ? "exploding" : "flying";
    return m;
  }, [leaving, exploding, tasks]);

  const activePauseId = useClockValue((now) => getActivePause(pauses, now)?.id ?? null, null);
  const activePause = pauses.find((p) => p.id === activePauseId) ?? null;

  const destroyed = incident?.phase === "post_mortem";
  const rebuilding = incident?.phase === "rebuilding";
  const activeTasks = tasks.filter((t) => t.status === "active" || exploding?.ids.has(t.id));
  const pendingPostMortems = incident
    ? incident.tasks
        .filter((t) => t.exploded && !t.postMortemDone)
        .map((t) => tasks.find((x) => x.id === t.taskId))
        .filter((t) => !!t)
    : [];
  const blocked = destroyed || rebuilding;

  const onTidy = useCallback(() => {
    void layoutTasks(readingOrder(activeTasks, positions));
  }, [layoutTasks, activeTasks, positions]);

  const onSort = useCallback(
    (by: BoardSort) => {
      void layoutTasks(sortTasks(activeTasks, pauses, getNow(), by));
    },
    [layoutTasks, activeTasks, pauses],
  );

  const detailsTask = tasks.find((t) => t.id === detailsId && t.status === "active") ?? null;
  const cutWireTask = tasks.find((t) => t.id === cutWire?.id && t.status === "active") ?? null;

  const getNextDeadlineInMs = useCallback(() => {
    const now = getNow();
    const r = tasks.filter((t) => t.status === "active").map((t) => getRemainingMs(t, pauses, now));
    return r.length ? Math.min(...r) : null;
  }, [tasks, pauses]);

  const empty = !blocked && (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="pointer-events-auto max-w-sm text-center motion-safe:animate-[rise-in_500ms_ease-out]">
        <p className="text-2xl font-semibold tracking-tight">Your board is quiet.</p>
        <p className="mt-2 text-muted-foreground">Light your first fuse.</p>
        <Button size="lg" className="mt-6 tracking-[0.2em]" onClick={() => setCreateOpen(true)} disabled={!online}>
          <Plus aria-hidden /> NEW TASK
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader
        active="board"
        onNewTask={() => setCreateOpen(true)}
        onEmergency={() => setPauseOpen(true)}
        onTidy={onTidy}
        onSort={onSort}
        newTaskDisabled={blocked || !online}
        emergencyDisabled={blocked || !!activePause || !online}
        arrangeDisabled={blocked || !online || activeTasks.length === 0}
      />
      {!online && (
        <div role="status" className="flex items-center justify-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <WifiOff className="size-4" aria-hidden /> You&apos;re offline. Actions are disabled until you reconnect; fuses keep burning.
        </div>
      )}
      {activePause && !blocked && <PauseBanner pause={activePause} onEnded={refresh} />}
      {restored && (
        <div role="status" className="border-b bg-stone-900 px-4 py-3 text-center text-stone-100 motion-safe:animate-[rise-in_400ms_ease-out]">
          <span className="font-semibold tracking-[0.25em]">BOARD RESTORED</span>
          <span className="ml-3 text-stone-400">Don&apos;t let it happen again.</span>
        </div>
      )}

      {!mounted ? (
        <div className="flex-1" aria-busy="true" />
      ) : rebuilding ? (
        <RebuildCanvas
          tasks={tasks}
          pauses={pauses}
          incident={incident!}
          onDue={onDue}
          onChanged={refresh}
          onRestored={() => {
            setRestored(true);
            setTimeout(() => setRestored(false), 4000);
            refresh();
          }}
        />
      ) : (
        <>
          {exploding && !reducedMotion && <div aria-hidden className="pointer-events-none fixed inset-0 z-[150000] animate-[flash_700ms_ease-out_forwards] bg-amber-50" />}
          <BoardCanvas
            tasks={destroyed && !exploding ? [] : activeTasks}
            pauses={pauses}
            positions={positions}
            motions={motions}
            paused={!!activePause}
            shaking={!!exploding}
            interactive={!blocked && online}
            onMove={onMove}
            onOpen={setDetailsId}
            onDue={onDue}
            empty={empty}
          />
        </>
      )}

      {mounted && destroyed && !exploding && <ExplosionOverlay pending={pendingPostMortems} onDone={refresh} />}

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        position={getNewTaskPosition(Object.values(positions))}
        onCreated={refresh}
        disabled={!online}
      />
      <TaskDetailsDialog
        task={detailsTask}
        pauses={pauses}
        events={events}
        onClose={() => setDetailsId(null)}
        onCompleted={onCompleted}
        onCutWire={(id, desiredEnd) => {
          setDetailsId(null);
          setCutWire({ id, desiredEnd });
        }}
        onChanged={refresh}
      />
      <CutWireDialog
        task={cutWireTask}
        pauses={pauses}
        desiredEnd={cutWire?.desiredEnd}
        onClose={() => setCutWire(null)}
        onDone={() => {
          setCutWire(null);
          refresh();
        }}
      />
      <EmergencyPauseDialog open={pauseOpen} onOpenChange={setPauseOpen} onDone={refresh} />

      {process.env.NODE_ENV === "development" && <TimeTravelPanel getNextDeadlineInMs={getNextDeadlineInMs} />}
    </div>
  );
}
