"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceGroup, DateTimeField, FieldError, toLocalInput } from "@/components/choice-group";
import { TaskScarOverlay } from "@/components/board/task-scar-overlay";
import { getNow } from "@/lib/clock";
import { useOnline } from "@/lib/use-online";
import { FUSE_PRESETS, resolveFusePreset, type FusePreset } from "@/domain/presets";
import { formatDuration, getFuseMs } from "@/domain/time";
import { getScarLevel } from "@/domain/scars";
import { MIN_EXPLANATION_LENGTH } from "@/domain/rules";
import { WHAT_HAPPENED, type Task, type WhatHappened } from "@/domain/types";
import { submitPostMortem } from "@/server/actions";
import { completeToast, playCompleteChime } from "@/lib/celebrate";

/**
 * Destroyed board. Cannot be dismissed (no close button, Escape and outside clicks ignored)
 * and survives refresh because it renders from the persisted incident.
 */
export function ExplosionOverlay({ pending, onDone }: { pending: Task[]; onDone: () => void }) {
  const [step, setStep] = useState<"intro" | "postmortem">("intro");
  const task = pending[0];
  if (!task) return null;

  return (
    <Dialog open onOpenChange={() => {}} disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        className="max-h-[96dvh] overflow-y-auto border-0 bg-stone-950 p-0 text-stone-100 ring-0 sm:max-w-xl"
        data-testid="explosion-overlay"
      >
        {step === "intro" ? (
          <div className="space-y-6 p-8 motion-safe:animate-[rise-in_500ms_ease-out]">
            <p className="font-mono text-xs tracking-[0.35em] text-red-400">INCIDENT</p>
            <DialogTitle className="text-4xl leading-none font-bold tracking-tight text-white">YOUR BOARD EXPLODED</DialogTitle>
            <DialogDescription className="text-lg text-stone-300">
              “{task.title}” ran out of time.
              {pending.length > 1 && <span className="block text-sm text-stone-400">…and {pending.length - 1} more.</span>}
            </DialogDescription>
            <div className="relative overflow-hidden rounded-lg border border-stone-800 bg-stone-900 p-4">
              <TaskScarOverlay level={getScarLevel(task.explosionCount)} />
              <dl className="relative grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-stone-400">Fuse</dt>
                  <dd className="font-medium">{formatDuration(getFuseMs(task))}</dd>
                </div>
                <div>
                  <dt className="text-stone-400">Explosions</dt>
                  <dd className="font-medium" data-testid="overlay-explosions">
                    {task.explosionCount}
                  </dd>
                </div>
              </dl>
            </div>
            <p className="text-stone-300">Before rebuilding, deal with the task.</p>
            <Button size="lg" className="w-full bg-white tracking-[0.25em] text-stone-950 hover:bg-stone-200" onClick={() => setStep("postmortem")} autoFocus>
              CONTINUE
            </Button>
          </div>
        ) : (
          <PostMortemForm
            key={task.id}
            task={task}
            onDone={() => {
              setStep("intro");
              onDone();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Resolution = "complete" | "reschedule" | "discard";

function PostMortemForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const online = useOnline();
  const [reason, setReason] = useState<WhatHappened>();
  const [explanation, setExplanation] = useState("");
  const [resolution, setResolution] = useState<Resolution>();
  const [fuse, setFuse] = useState<FusePreset>();
  const [custom, setCustom] = useState(toLocalInput(new Date(getNow() + 86_400_000)));
  const [discardReason, setDiscardReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!reason) errs.reason = "Pick what happened.";
    if (explanation.trim().length < MIN_EXPLANATION_LENGTH) errs.explanation = "Explain it to yourself, briefly.";
    if (!resolution) errs.resolution = "Decide what happens now.";
    let newEnd: Date | null = null;
    if (resolution === "reschedule") {
      newEnd = !fuse ? null : fuse === "custom" ? new Date(custom) : resolveFusePreset(fuse, new Date(getNow()));
      if (!newEnd || Number.isNaN(newEnd.getTime()) || newEnd.getTime() <= getNow() + 60_000) errs.newEnd = "Pick a new deadline in the future.";
    }
    if (resolution === "discard" && discardReason.trim().length < MIN_EXPLANATION_LENGTH) errs.discard = "Why is this task no longer necessary?";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setPending(true);
    setSubmitError(null);
    const res = await submitPostMortem({
      taskId: task.id,
      reason: reason!,
      explanation,
      resolution: resolution!,
      newEnd: newEnd?.toISOString() ?? null,
      discardReason: resolution === "discard" ? discardReason : null,
    });
    setPending(false);
    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    if (resolution === "complete") {
      playCompleteChime();
      const copy = completeToast(task.title, task.explosionCount);
      toast.success(copy.title, { description: copy.description, duration: 4200 });
    } else {
      toast(resolution === "reschedule" ? "Fuse relit." : "Task discarded.", { description: "The scar stays." });
    }
    onDone();
  }

  const dark = "border-stone-700 bg-stone-900 text-stone-100";

  return (
    <form onSubmit={submit} className="space-y-6 p-8" noValidate>
      <div className="space-y-1">
        <p className="font-mono text-xs tracking-[0.35em] text-red-400">POST-MORTEM</p>
        <DialogTitle className="text-2xl font-semibold text-white">{task.title}</DialogTitle>
        <DialogDescription className="text-stone-400">Be honest. Nobody else reads this.</DialogDescription>
      </div>

      <div className="[&_label]:border-stone-700 [&_label]:bg-stone-900 [&_label]:text-stone-200 [&_label:has(:checked)]:border-white [&_label:has(:checked)]:bg-white [&_label:has(:checked)]:text-stone-950">
        <ChoiceGroup legend="What happened?" name="pm-reason" columns={2} options={WHAT_HAPPENED} value={reason} onChange={setReason} error={errors.reason} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pm-explain" className="text-sm font-semibold">
          Explain
        </Label>
        <Textarea id="pm-explain" rows={3} className={dark} value={explanation} onChange={(e) => setExplanation(e.target.value)} aria-invalid={!!errors.explanation} />
        <FieldError message={errors.explanation} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">What happens now?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["complete", "COMPLETE TASK"],
              ["reschedule", "RESCHEDULE"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              type="button"
              size="lg"
              aria-pressed={resolution === v}
              variant="outline"
              className="border-stone-700 bg-stone-900 tracking-[0.15em] text-stone-100 hover:bg-stone-800 hover:text-white aria-pressed:border-white aria-pressed:bg-white aria-pressed:text-stone-950"
              onClick={() => setResolution(v)}
            >
              {label}
            </Button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={resolution === "discard"}
          onClick={() => setResolution("discard")}
          className="text-sm text-stone-400 underline-offset-4 hover:text-stone-200 hover:underline aria-pressed:text-white aria-pressed:underline"
        >
          Discard task
        </button>
        <FieldError message={errors.resolution} />
      </fieldset>

      {resolution === "reschedule" && (
        <div className="space-y-3 [&_label]:border-stone-700 [&_label]:bg-stone-900 [&_label]:text-stone-200 [&_label:has(:checked)]:border-white [&_label:has(:checked)]:bg-white [&_label:has(:checked)]:text-stone-950">
          <ChoiceGroup legend="New deadline" name="pm-fuse" options={FUSE_PRESETS} value={fuse} onChange={setFuse} error={fuse !== "custom" ? errors.newEnd : undefined} />
          {fuse === "custom" && (
            <div className="[&_input]:border-stone-700 [&_input]:bg-stone-900 [&_input]:text-stone-100">
              <DateTimeField label="New deadline" value={custom} onChange={setCustom} error={errors.newEnd} />
            </div>
          )}
        </div>
      )}

      {resolution === "discard" && (
        <div className="space-y-2">
          <Label htmlFor="pm-discard" className="text-sm font-semibold">
            Why is this task no longer necessary?
          </Label>
          <Textarea id="pm-discard" rows={2} className={dark} value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} />
          <FieldError message={errors.discard} />
          <p className="text-xs text-stone-500">Discarded tasks stay in your history. Nothing is deleted.</p>
        </div>
      )}

      {submitError && (
        <p role="alert" className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">
          {submitError}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full bg-white tracking-[0.25em] text-stone-950 hover:bg-stone-200" disabled={pending || !online}>
        {pending ? "SAVING…" : "SUBMIT POST-MORTEM"}
      </Button>
    </form>
  );
}
