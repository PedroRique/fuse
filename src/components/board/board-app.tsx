"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/app-header";
import { BoardCanvas } from "./board-canvas";
import { TaskList } from "./task-list";
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
import { clampToBoard, getNewTaskPosition } from "@/domain/board";
import { packCards, readingOrder, sortTasks, type BoardSort } from "@/domain/layout";
import { getTaskTemporalState } from "@/domain/urgency";
import type { BoardSnapshot } from "@/server/queries";
import { completeToast, playCompleteChime } from "@/lib/celebrate";
import { moveTask, syncBoard, undoCompleteTask, undoLayout } from "@/server/actions";
import type { Task } from "@/domain/types";
import { settleDrop } from "@/domain/drop-layout";
import { visualSize } from "@/domain/layout";
import { useBoardPreferences } from "@/lib/board-preferences";
import { PushSettings } from "@/components/push-settings";

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
  useEffect(() => {
    const openTask = () => {
      const id = new URL(window.location.href).searchParams.get("task");
      if (id) setDetailsId(id);
    };
    openTask();
    navigator.serviceWorker?.addEventListener("message", openTask);
    return () => navigator.serviceWorker?.removeEventListener("message", openTask);
  }, []);
  const [cutWire, setCutWire] = useState<{ id: string; desiredEnd?: Date } | null>(null);
  const [restored, setRestored] = useState(false);
  const preferences = useBoardPreferences();
  const pendingArrangement = useRef<string | null>(null);
  const onCreated = useCallback((taskId: string) => {
    pendingArrangement.current = taskId;
    refresh();
  }, [refresh]);

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
  const offerLayoutUndo = useCallback((before: Record<string, { x: number; y: number }>, after: Record<string, { x: number; y: number }>) => {
    const changes = Object.entries(after).filter(([id, p]) => before[id] && (p.x !== before[id].x || p.y !== before[id].y))
      .map(([id, p]) => ({ id, ...before[id], expectedX: p.x, expectedY: p.y }));
    if (!changes.length) return;
    let used = false;
    const expires = Date.now() + 15_000;
    toast.success("Board rearranged.", { duration: 15_000, action: { label: "Undo", onClick: async () => {
      if (used || Date.now() > expires) return;
      used = true;
      const result = await undoLayout({ changes });
      if (!result.ok) { toast.error("Couldn't undo that arrangement.", { description: result.error }); return; }
      setMoved((previous) => ({ key: incidentKey, map: { ...(previous.key === incidentKey ? previous.map : {}), ...Object.fromEntries(changes.map((c) => [c.id, { x: c.x, y: c.y }])) } }));
      refresh();
    } } });
  }, [incidentKey, refresh]);
  const onMove = useCallback(
    async (id: string, x: number, y: number, sizes: Record<string, { width: number; height: number }>) => {
      const cards = tasks.filter((t) => t.status === "active" || (t.status === "completed" && !preferences.hideCompleted)).map((t) => {
        const size = visualSize(getTaskTemporalState(t, pauses, getNow()).scale);
        return { id: t.id, ...positions[t.id], ...(sizes[t.id] ?? { width: size.w, height: size.h }) };
      });
      const next = settleDrop(cards, id, x, y);
      if (!next) {
        toast.error("Not enough room for this move.", { description: "Zoom out or tidy the board first." });
        return;
      }
      setMoved({ key: incidentKey, map: next });
      const changes = Object.entries(next).filter(([key, p]) => p.x !== positions[key]?.x || p.y !== positions[key]?.y);
      const results = await Promise.all(changes.map(([taskId, p]) => moveTask({ taskId, ...p })));
      const failure = results.find((r) => !r.ok);
      if (failure && !failure.ok) {
        setMoved({ key: incidentKey, map: {} });
        toast.error("Couldn't rearrange the cards.", { description: failure.error });
        refresh();
      } else {
        offerLayoutUndo(positions, next);
      }
    },
    [incidentKey, tasks, pauses, positions, refresh, preferences.hideCompleted, offerLayoutUndo],
  );

  const layoutTasks = useCallback(
    async (ordered: Task[]) => {
      if (!ordered.length) return;
      const now = getNow();
      const packed = packCards(ordered.map((t) => ({ id: t.id, scale: getTaskTemporalState(t, pauses, now).scale })));
      const next = Object.fromEntries(Object.entries(packed).map(([id, p]) => [id, clampToBoard(p.x, p.y)]));
      setMoved({ key: incidentKey, map: next });
      const results = await Promise.all(Object.entries(next).map(([id, p]) => moveTask({ taskId: id, x: p.x, y: p.y })));
      const fail = results.find((r) => !r.ok);
      if (fail && !fail.ok) {
        setMoved({ key: incidentKey, map: {} });
        toast.error("Couldn't rearrange the board.", { description: fail.error });
        refresh();
      } else {
        offerLayoutUndo(positions, next);
      }
    },
    [pauses, incidentKey, refresh, positions, offerLayoutUndo],
  );

  // --- completion: animate only after the server confirmed ---
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const onCompleted = useCallback(
    (id: string) => {
      setDetailsId(null);
      setLeaving((s) => new Set(s).add(id));
      const t = tasks.find((x) => x.id === id);
      playCompleteChime();
      const copy = completeToast(t?.title ?? "Task", t?.explosionCount ?? 0);
      let used = false;
      const expires = Date.now() + 15_000;
      toast.success(copy.title, { description: copy.description, duration: 15_000, action: { label: "Undo", onClick: async () => {
        if (used || Date.now() > expires) return;
        used = true;
        const result = await undoCompleteTask({ taskId: id });
        if (!result.ok) { toast.error("Couldn't undo completion.", { description: result.error }); return; }
        setLeaving((previous) => { const next = new Set(previous); next.delete(id); return next; });
        refresh();
        toast.success("Completion undone.");
      } } });
      setTimeout(refresh, reducedMotion ? 220 : 1000);
    },
    [tasks, refresh, reducedMotion],
  );

  const motions = useMemo(() => {
    const m: Record<string, CardMotion> = {};
    for (const t of tasks) {
      if (leaving.has(t.id) && t.status !== "completed") m[t.id] = "leaving";
    }
    if (exploding) {
      for (const t of tasks) {
        if (t.status === "completed") continue;
        m[t.id] = exploding.ids.has(t.id) ? "exploding" : "flying";
      }
    }
    return m;
  }, [leaving, exploding, tasks]);

  const activePauseId = useClockValue((now) => getActivePause(pauses, now)?.id ?? null, null);
  const activePause = pauses.find((p) => p.id === activePauseId) ?? null;

  const destroyed = incident?.phase === "post_mortem";
  const rebuilding = incident?.phase === "rebuilding";
  const boardTasks = tasks.filter((t) => t.status === "active" || (t.status === "completed" && !preferences.hideCompleted) || exploding?.ids.has(t.id));
  const pendingPostMortems = incident
    ? incident.tasks
        .filter((t) => t.exploded && !t.postMortemDone)
        .map((t) => tasks.find((x) => x.id === t.taskId))
        .filter((t) => !!t)
    : [];
  const blocked = destroyed || rebuilding;
  // Filters/search can hide an expiring row. Sync deadlines independently of visible cards.
  const dueTasks = useClockValue((now) => tasks.filter((task) => task.status === "active" && getRemainingMs(task, pauses, now) <= 0).map((task) => task.id).join("|"), "");
  useEffect(() => {
    if (dueTasks && online && !blocked) void onDue();
  }, [dueTasks, online, blocked, onDue]);

  const onTidy = useCallback(() => {
    void layoutTasks(readingOrder(boardTasks, positions));
  }, [layoutTasks, boardTasks, positions]);

  const onSort = useCallback(
    (by: BoardSort) => {
      preferences.update({ sort: by });
      if (preferences.view === "list") return;
      void layoutTasks(sortTasks(boardTasks, pauses, getNow(), by));
    },
    [layoutTasks, boardTasks, pauses, preferences],
  );

  // Wait for the refreshed snapshot so the new card participates in the layout.
  useEffect(() => {
    const id = pendingArrangement.current;
    if (!id || !tasks.some((t) => t.id === id)) return;
    pendingArrangement.current = null;
    if (blocked || !online || preferences.view === "list") return;
    const visible = tasks.filter((t) => t.status === "active" || (t.status === "completed" && !preferences.hideCompleted));
    void layoutTasks(sortTasks(visible, pauses, getNow(), preferences.sort));
  }, [tasks, pauses, blocked, online, layoutTasks, preferences.hideCompleted, preferences.sort, preferences.view]);

  const detailsTask = tasks.find((t) => t.id === detailsId && (t.status === "active" || t.status === "completed")) ?? null;
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
        onTidy={preferences.view === "canvas" ? onTidy : undefined}
        onSort={onSort}
        sortBy={preferences.sort}
        hideCompleted={preferences.hideCompleted}
        completedCount={tasks.filter((t) => t.status === "completed").length}
        onToggleCompleted={() => preferences.update({ hideCompleted: !preferences.hideCompleted })}
        newTaskDisabled={blocked || !online}
        emergencyDisabled={blocked || !!activePause || !online}
        arrangeDisabled={blocked || !online || boardTasks.length === 0}
      />
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 sm:px-6" role="group" aria-label="Task view">
        <Button size="sm" variant={preferences.view === "canvas" ? "default" : "outline"} aria-pressed={preferences.view === "canvas"} onClick={() => preferences.update({ view: "canvas" })}>Canvas</Button>
        <Button size="sm" variant={preferences.view === "list" ? "default" : "outline"} aria-pressed={preferences.view === "list"} onClick={() => preferences.update({ view: "list" })}>List</Button>
        <PushSettings />
      </div>
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
          {preferences.view === "list" ? <TaskList tasks={destroyed && !exploding ? [] : tasks} pauses={pauses} sort={preferences.sort} filter={preferences.listFilter} onFilterChange={(listFilter) => preferences.update({ listFilter })} hideCompleted={preferences.hideCompleted} onOpen={setDetailsId} onDue={onDue} interactive={!blocked && online} empty={empty} /> : <BoardCanvas
            tasks={destroyed && !exploding ? [] : boardTasks}
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
          />}
        </>
      )}

      {mounted && destroyed && !exploding && <ExplosionOverlay pending={pendingPostMortems} onDone={refresh} />}

      {!blocked && !createOpen && !detailsId && !pauseOpen && !cutWire && <Button
        type="button" aria-label="New task" disabled={!online} onClick={() => setCreateOpen(true)}
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 h-14 w-14 rounded-full shadow-lg sm:hidden">
        <Plus className="size-6" aria-hidden />
      </Button>}

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        position={getNewTaskPosition(Object.values(positions))}
        onCreated={onCreated}
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
