"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, Pencil, Scissors } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceGroup, DateTimeField, toLocalInput } from "@/components/choice-group";
import { ImpactBadge } from "@/components/board/impact-badge";
import { describeTemporal } from "@/components/board/task-card-face";
import { describeEvent } from "@/components/history/describe-event";
import { useNow } from "@/lib/clock";
import { useOnline } from "@/lib/use-online";
import { getTaskTemporalState } from "@/domain/urgency";
import { formatCountdown, formatDuration, getEffectiveDeadline } from "@/domain/time";
import { judgeDeadlineEdit, CRITICAL_EDIT_THRESHOLD } from "@/domain/rules";
import { IMPACTS, type BoardPause, type Impact, type Task, type TaskEvent } from "@/domain/types";
import { completeTask, rescheduleTask, updateTaskContent } from "@/server/actions";

export function TaskDetailsDialog({
  task,
  pauses,
  events,
  onClose,
  onCompleted,
  onCutWire,
  onChanged,
}: {
  task: Task | null;
  pauses: readonly BoardPause[];
  events: TaskEvent[];
  onClose: () => void;
  onCompleted: (id: string) => void;
  onCutWire: (id: string, desiredEnd?: Date) => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {task && (
          <Details
            key={task.id}
            task={task}
            pauses={pauses}
            events={events.filter((e) => e.taskId === task.id)}
            onCompleted={onCompleted}
            onCutWire={onCutWire}
            onChanged={onChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Details({
  task,
  pauses,
  events,
  onCompleted,
  onCutWire,
  onChanged,
}: {
  task: Task;
  pauses: readonly BoardPause[];
  events: TaskEvent[];
  onCompleted: (id: string) => void;
  onCutWire: (id: string, desiredEnd?: Date) => void;
  onChanged: () => void;
}) {
  const now = useNow();
  const online = useOnline();
  const t = getTaskTemporalState(task, pauses, now);
  const end = getEffectiveDeadline(task, pauses, now);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "done" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: task.title, notes: task.notes ?? "", impact: task.impact, end: toLocalInput(new Date(end)) });

  async function markDone() {
    setBusy("done");
    setError(null);
    const res = await completeTask({ taskId: task.id });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      onChanged();
      return;
    }
    onCompleted(task.id);
  }

  async function save() {
    setBusy("save");
    setError(null);
    const newEnd = new Date(draft.end).getTime();
    const deadlineChanged = Math.abs(newEnd - new Date(toLocalInput(new Date(end))).getTime()) >= 60_000;

    if (deadlineChanged) {
      const verdict = judgeDeadlineEdit(task, pauses, now, newEnd);
      if (verdict.kind === "requires_wire_cut") {
        setBusy(null);
        onCutWire(task.id, new Date(newEnd));
        return;
      }
      if (verdict.kind === "invalid") {
        setBusy(null);
        setError(verdict.message);
        return;
      }
    }

    const content = await updateTaskContent({ taskId: task.id, title: draft.title, notes: draft.notes, impact: draft.impact });
    if (!content.ok) {
      setBusy(null);
      setError(content.error);
      return;
    }
    if (deadlineChanged) {
      const res = await rescheduleTask({ taskId: task.id, newEnd: new Date(newEnd).toISOString() });
      if (!res.ok) {
        setBusy(null);
        if (res.code === "REQUIRES_WIRE_CUT") onCutWire(task.id, new Date(newEnd));
        else setError(res.error);
        return;
      }
    }
    setBusy(null);
    setEditing(false);
    toast.success("Saved.");
    onChanged();
  }

  const locked = t.progress >= CRITICAL_EDIT_THRESHOLD;
  const completed = task.status === "completed";

  return (
    <>
      <DialogHeader>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{describeTemporal(t, task)}</p>
        <DialogTitle className="text-xl leading-tight font-semibold text-balance">{task.title}</DialogTitle>
        {task.notes && !editing && <DialogDescription className="whitespace-pre-wrap">{task.notes}</DialogDescription>}
        {!task.notes && <DialogDescription className="sr-only">Task details</DialogDescription>}
      </DialogHeader>

      {!editing ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <Stat label="Remaining">
            <span className={t.isFinalCountdown ? "font-mono font-bold text-red-800" : "font-mono"} data-testid="details-remaining">
              {completed ? "Out" : formatCountdown(t.remainingMs)}
            </span>
          </Stat>
          <Stat label="Fuse burned">{Math.round(t.progress * 100)}%</Stat>
          <Stat label="Deadline">{format(new Date(end), "EEE, d MMM · HH:mm")}</Stat>
          <Stat label="Fuse">{formatDuration(t.fuseMs)}</Stat>
          <Stat label="Impact">
            <ImpactBadge impact={task.impact} />
          </Stat>
          <Stat label="Explosions">
            <span data-testid="details-explosions">{task.explosionCount}</span>
          </Stat>
          <Stat label="Created">{format(new Date(task.createdAt), "d MMM yyyy · HH:mm")}</Stat>
          {completed && task.completedAt && <Stat label="Completed">{format(new Date(task.completedAt), "d MMM yyyy · HH:mm")}</Stat>}
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">What needs to be done?</Label>
            <Input id="edit-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea id="edit-notes" rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          <ChoiceGroup
            legend="Impact if you don't do it"
            name="edit-impact"
            options={IMPACTS.map((i) => ({ value: i, label: i[0].toUpperCase() + i.slice(1) }))}
            value={draft.impact}
            onChange={(v) => setDraft({ ...draft, impact: v as Impact })}
          />
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">When does it become a problem?</p>
            {locked && (
              <p className="text-xs text-muted-foreground">
                This fuse is {Math.round(t.progress * 100)}% burned. Moving the deadline later means cutting the wire.
              </p>
            )}
            <DateTimeField label="Deadline" value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!editing ? (
        completed ? (
          <p className="text-sm text-emerald-800">This fuse is out. It stays on the board as a reminder you did the thing.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="lg"
              className="flex-1 bg-emerald-700 tracking-[0.15em] text-white hover:bg-emerald-800"
              onClick={markDone}
              disabled={!!busy || !online || task.status !== "active"}
            >
              <Check aria-hidden /> {busy === "done" ? "SAVING…" : "MARK AS DONE"}
            </Button>
            <Button size="lg" variant="outline" className="flex-1 tracking-[0.15em]" onClick={() => onCutWire(task.id)} disabled={!!busy || !online || task.status !== "active"}>
              <Scissors aria-hidden /> CUT THE WIRE
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit task" disabled={task.status !== "active"}>
              <Pencil aria-hidden />
            </Button>
          </div>
        )
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" onClick={save} disabled={!!busy || !online}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}

      {events.length > 0 && (
        <section aria-labelledby="task-history" className="space-y-2">
          <h3 id="task-history" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            History
          </h3>
          <ol className="space-y-2 text-sm">
            {events.map((e) => {
              const d = describeEvent(e, task.explosionCount);
              return (
                <li key={e.id} className="flex gap-3">
                  <time className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={e.occurredAt}>
                    {format(new Date(e.occurredAt), "d MMM HH:mm")}
                  </time>
                  <span>
                    <span className="font-medium">{d.title}</span>
                    {d.detail && <span className="text-muted-foreground"> · {d.detail}</span>}
                    {d.reason && <span className="block text-xs text-muted-foreground">{d.reason}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
}

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 font-medium">{children}</dd>
  </div>
);
