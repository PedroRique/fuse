"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceGroup, DateTimeField, FieldError, toLocalInput } from "@/components/choice-group";
import { getNow } from "@/lib/clock";
import { useOnline } from "@/lib/use-online";
import { EXTENSION_PRESETS, resolveExtension, type ExtensionPreset } from "@/domain/presets";
import { formatDuration, getEffectiveDeadline } from "@/domain/time";
import { MIN_EXPLANATION_LENGTH } from "@/domain/rules";
import { WHAT_HAPPENED, type BoardPause, type Task, type WhatHappened } from "@/domain/types";
import { cutWire } from "@/server/actions";

export function CutWireDialog({
  task,
  pauses,
  desiredEnd,
  onClose,
  onDone,
}: {
  task: Task | null;
  pauses: readonly BoardPause[];
  desiredEnd?: Date;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {task && <CutWireForm key={task.id} task={task} pauses={pauses} desiredEnd={desiredEnd} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function CutWireForm({ task, pauses, desiredEnd, onDone }: { task: Task; pauses: readonly BoardPause[]; desiredEnd?: Date; onDone: () => void }) {
  const online = useOnline();
  const [reason, setReason] = useState<WhatHappened>();
  const [explanation, setExplanation] = useState("");
  const [preset, setPreset] = useState<ExtensionPreset | undefined>(desiredEnd ? "custom" : undefined);
  const [custom, setCustom] = useState(desiredEnd ? toLocalInput(desiredEnd) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const now = getNow();
  const currentEnd = getEffectiveDeadline(task, pauses, now);
  const newEnd =
    preset === "custom" ? (custom ? new Date(custom) : null) : preset ? resolveExtension(preset, new Date(currentEnd), new Date(now)) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!reason) errs.reason = "Pick what happened.";
    if (explanation.trim().length < MIN_EXPLANATION_LENGTH) errs.explanation = "A few honest words are enough.";
    if (!newEnd || Number.isNaN(newEnd.getTime())) errs.time = "How much more time do you need?";
    else if (newEnd.getTime() <= currentEnd) errs.time = "That doesn't give you more time.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setPending(true);
    setSubmitError(null);
    const res = await cutWire({ taskId: task.id, reason: reason!, explanation, newEnd: newEnd!.toISOString() });
    setPending(false);
    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    toast("Wire cut.", { description: `+${formatDuration(newEnd!.getTime() - currentEnd)} for “${task.title}”. Scars stay.` });
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <DialogHeader>
        <DialogTitle className="text-xl font-semibold">Cut the wire?</DialogTitle>
        <DialogDescription>You&apos;re changing a commitment you made to yourself.</DialogDescription>
      </DialogHeader>

      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">{task.title}</span>
        <span className="block text-xs text-muted-foreground">Currently due {format(new Date(currentEnd), "EEE, d MMM · HH:mm")}</span>
      </p>

      <ChoiceGroup
        legend="What happened?"
        name="wire-reason"
        columns={2}
        options={WHAT_HAPPENED}
        value={reason}
        onChange={setReason}
        error={errors.reason}
      />

      <div className="space-y-2">
        <Label htmlFor="wire-why" className="text-sm font-semibold">
          Tell yourself why
        </Label>
        <Textarea id="wire-why" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} aria-invalid={!!errors.explanation} />
        <FieldError message={errors.explanation} />
      </div>

      <ChoiceGroup
        legend="How much more time do you need?"
        name="wire-time"
        columns={3}
        options={EXTENSION_PRESETS}
        value={preset}
        onChange={setPreset}
        error={preset !== "custom" ? errors.time : undefined}
      />
      {preset === "custom" && <DateTimeField label="New deadline" value={custom} onChange={setCustom} error={errors.time} />}
      {newEnd && !Number.isNaN(newEnd.getTime()) && newEnd.getTime() > currentEnd && (
        <p className="text-sm text-muted-foreground">
          New deadline: <span className="font-medium text-foreground">{format(newEnd, "EEE, d MMM · HH:mm")}</span> (+
          {formatDuration(newEnd.getTime() - currentEnd)})
        </p>
      )}

      {submitError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full tracking-[0.2em]" disabled={pending || !online}>
        {pending ? "CUTTING…" : "CUT THE WIRE"}
      </Button>
    </form>
  );
}
