"use client";

import { memo, useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNow } from "@/lib/clock";
import { getTaskTemporalState } from "@/domain/urgency";
import { sortTasks, type BoardSort } from "@/domain/layout";
import { findTasks } from "@/domain/search";
import { formatCountdown, formatDuration, getEffectiveDeadline } from "@/domain/time";
import { filterListTasks, LIST_FILTERS, type ListFilter } from "@/domain/list-filters";
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
  // Apply the canvas multiplier directly to row height, text and spacing.
  // Real layout dimensions keep rows apart and text sharp at every scale.
  const scale = temporal.scale;
  const hot = !done && !temporal.isDormant && temporal.state === "critical";
  return <li>
    <button type="button" disabled={!interactive} onClick={() => onOpen(task.id)} data-testid="task-list-row" data-task-id={task.id}
      className={cn("flex w-full flex-col justify-center rounded-xl border bg-white px-4 text-left text-stone-900 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-default", done && "border-emerald-200 bg-emerald-50", hot && "border-red-400")}
      style={{ minHeight: 160 * scale, paddingBlock: 16 * scale, backgroundColor: !done && temporal.heat ? `color-mix(in oklch, white, ${hot ? "#dc2626" : "#ea580c"} ${Math.round(temporal.heat * 24)}%)` : undefined }}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-stone-600">
        <span className="flex items-center gap-1">{done && <Check className="size-3" aria-hidden />}{describeTemporal(temporal, task)}</span>
        {!done && <span className={cn("font-mono tabular-nums", hot && "font-bold text-red-800")}>{temporal.isFinalCountdown ? formatCountdown(temporal.remainingMs) : `${formatDuration(temporal.remainingMs)} left`}</span>}
      </div>
      <p className={cn("my-2 line-clamp-3 break-words leading-tight font-semibold", done && "text-stone-600")}
        style={{ fontSize: done ? 16 : 18 * scale }}>{task.title}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <ImpactBadge impact={task.impact} />
        <span>Due {format(new Date(done ? task.deadlineAt : getEffectiveDeadline(task, pauses, now || Date.parse(task.fuseStartedAt))), "dd MMM, HH:mm")}</span>
        {task.explosionCount > 0 && <span>Exploded ×{task.explosionCount}</span>}
      </div>
      {!done && <div className="mt-3"><FuseIndicator progress={temporal.progress} state={temporal.isDormant ? "safe" : temporal.state} animate={false} /></div>}
    </button>
  </li>;
});

export function TaskList({ tasks, pauses, sort, filter, onFilterChange, hideCompleted, onOpen, onDue, interactive, empty }: {
  tasks: Task[]; pauses: readonly BoardPause[]; sort: BoardSort; onOpen: (id: string) => void;
  filter: ListFilter; onFilterChange: (filter: ListFilter) => void; hideCompleted: boolean;
  onDue: () => void; interactive: boolean; empty: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const now = useNow();
  const matchingFilter = filterListTasks(tasks, pauses, now, filter, hideCompleted);
  const filtered = query.trim() ? findTasks(matchingFilter, query) : matchingFilter;
  const ordered = sortTasks(filtered, pauses, now, sort);
  return <div className="relative isolate min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-28 sm:px-6 sm:pb-6">
    <div className="mx-auto max-w-3xl">
      <div role="search" className="mb-4 flex items-center gap-2"><Search className="size-4 text-muted-foreground" aria-hidden /><Input type="search" aria-label="Find a task by title" placeholder="Find a task by title…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div role="group" aria-label="Filter tasks" className="mb-3 flex flex-wrap gap-2">
        {LIST_FILTERS.map((option) => <Button key={option.value} size="sm" variant={filter === option.value ? "default" : "outline"}
          aria-pressed={filter === option.value} onClick={() => onFilterChange(option.value)}>
          {option.label}<span className="tabular-nums">{filterListTasks(tasks, pauses, now, option.value, hideCompleted).length}</span>
        </Button>)}
      </div>
      {tasks.length === 0 ? empty : ordered.length === 0 ? <div className="py-8 text-center text-muted-foreground">
        <p role="status">{query.trim() ? "No matching tasks in this filter." : "No tasks in this filter."}</p>
        {(filter !== "all" || query.trim()) && <Button variant="ghost" className="mt-2" onClick={() => { setQuery(""); onFilterChange("all"); }}>Show all tasks</Button>}
      </div> : <ul aria-label="Task list" className="space-y-3">{ordered.map((task) => <TaskRow key={task.id} task={task} pauses={pauses} onOpen={onOpen} onDue={onDue} interactive={interactive} />)}</ul>}
    </div>
  </div>;
}
