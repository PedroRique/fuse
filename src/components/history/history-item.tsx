import { format } from "date-fns";
import { Check, Flame, Pause, Play, RotateCcw, Scissors, Trash2, Undo2, Hammer, Sparkles, NotebookPen } from "lucide-react";
import type { HistoryEntry } from "@/server/queries";
import { getScarLevel } from "@/domain/scars";
import { TaskScarOverlay } from "@/components/board/task-scar-overlay";
import { describeEvent } from "./describe-event";

const ICONS = {
  created: Sparkles,
  completed: Check,
  wire_cut: Scissors,
  exploded: Flame,
  rescheduled: RotateCcw,
  discarded: Trash2,
  emergency_pause_started: Pause,
  emergency_pause_ended: Play,
  post_mortem: NotebookPen,
  board_restored: Hammer,
} as const;

export function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const d = describeEvent(entry, entry.task?.explosionCount ?? 0);
  const Icon = ICONS[entry.type] ?? Undo2;
  const scars = entry.task?.explosionCount ?? 0;
  return (
    <li className="relative flex gap-4 overflow-hidden px-4 py-3" data-testid="history-item" data-type={entry.type}>
      {/* Scars are preserved in the record, completed or not. */}
      {scars > 0 && entry.type === "completed" && <TaskScarOverlay level={getScarLevel(scars)} />}
      <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="truncate font-medium">{entry.task?.title ?? d.title}</p>
        <p className="text-sm text-muted-foreground">
          {entry.task ? d.title : null}
          {entry.task && d.detail ? " · " : null}
          {d.detail}
        </p>
        {d.reason && <p className="mt-0.5 text-sm text-muted-foreground">Reason: {d.reason}</p>}
      </div>
      <time className="relative shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={entry.occurredAt}>
        {format(new Date(entry.occurredAt), "d MMM · HH:mm")}
      </time>
    </li>
  );
}
