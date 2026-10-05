"use client";

import { memo, useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNow } from "@/lib/clock";
import { getTaskTemporalState, URGENCY } from "@/domain/urgency";
import { sortTasks, type BoardSort } from "@/domain/layout";
import { findTasks } from "@/domain/search";
import { formatCountdown, formatDuration } from "@/domain/time";
import type { BoardPause, Task } from "@/domain/types";
import { describeTemporal } from "./task-card-face";
import { ImpactBadge } from "./impact-badge";
import { FuseIndicator } from "./fuse-indicator";
import { cn } from "@/lib/utils";

const TaskRow = memo(function TaskRow({ task, pauses, onOpen, onDue, interactive }: {
  task: Task; pauses: readonly BoardPause[]; onOpen: (id: string) => void; onDue: () => void; interactive: boolean;
}) {
  const now = useNow();
  const temporal = getTaskTemporalState(task, pauses, now || Date.parse(task.fuseStartedAt));
  const done = task.status === "completed";
  const due = now > 0 && task.status === "active" && temporal.state === "exploded";
  useEffect(() => { if (due) onDue(); }, [due, onDue]);
  // Use the same urgency curve as the canvas, but grow typography and spacing rather than scaling text.
  const growth = Math.max(0, Math.min(1, (temporal.scale - 1) / (URGENCY.maxScale - 1)));
  const hot = !done && !temporal.isDormant && temporal.state === "critical";
  return <li>
    <button type="button" disabled={!interactive} onClick={() => onOpen(task.id)} data-testid="task-list-row" data-task-id={task.id}
      className={cn("w-full rounded-xl border bg-white px-4 text-left text-stone-900 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-default", done && "border-emerald-200 bg-emerald-50", hot && "border-red-400")}
      style={{ paddingBlock: done ? 12 : Math.round(16 + growth * 16), backgroundColor: !done && temporal.heat ? `color-mix(in oklch, white, ${hot ? "#dc2626" : "#ea580c"} ${Math.round(temporal.heat * 24)}%)` : undefined }}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-stone-600">
        <span className="flex items-center gap-1">{done && <Check className="size-3" aria-hidden />}{describeTemporal(temporal, task)}</span>
        {!done && <span className={cn("font-mono tabular-nums", hot && "font-bold text-red-800")}>{temporal.isFinalCountdown ? formatCountdown(temporal.remainingMs) : `${formatDuration(temporal.remainingMs)} left`}</span>}
      </div>
      <p className={cn("my-2 break-words leading-tight font-semibold", done && "text-stone-600")}
        style={{ fontSize: done ? 16 : Math.round(18 + growth * 14) }}>{task.title}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <ImpactBadge impact={task.impact} />
        <span>Due {format(new Date(task.deadlineAt), "dd MMM, HH:mm")}</span>
        {task.explosionCount > 0 && <span>Exploded ×{task.explosionCount}</span>}
      </div>
      {!done && <div className="mt-3"><FuseIndicator progress={temporal.progress} state={temporal.isDormant ? "safe" : temporal.state} animate={false} /></div>}
    </button>
  </li>;
});

export function TaskList({ tasks, pauses, sort, onOpen, onDue, interactive, empty }: {
  tasks: Task[]; pauses: readonly BoardPause[]; sort: BoardSort; onOpen: (id: string) => void;
  onDue: () => void; interactive: boolean; empty: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const now = useNow();
  const filtered = query.trim() ? findTasks(tasks, query) : tasks;
  const ordered = sortTasks(filtered, pauses, now, sort);
  return <div className="relative isolate min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6">
    <div className="mx-auto max-w-3xl">
      <div role="search" className="mb-4 flex items-center gap-2"><Search className="size-4 text-muted-foreground" aria-hidden /><Input type="search" aria-label="Find a task by title" placeholder="Find a task by title…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      {tasks.length === 0 ? empty : ordered.length === 0 ? <p role="status" className="py-8 text-center text-muted-foreground">No tasks found.</p> : <ul aria-label="Task list" className="space-y-3">{ordered.map((task) => <TaskRow key={task.id} task={task} pauses={pauses} onOpen={onOpen} onDue={onDue} interactive={interactive} />)}</ul>}
    </div>
  </div>;
}
