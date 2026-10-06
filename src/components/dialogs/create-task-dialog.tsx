"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceGroup, DateTimeField, FieldError, toLocalInput } from "@/components/choice-group";
import { FUSE_PRESETS, resolveFusePreset, type FusePreset } from "@/domain/presets";
import { IMPACTS, type Impact } from "@/domain/types";
import { getNow } from "@/lib/clock";
import { createTask } from "@/server/actions";

const IMPACT_OPTIONS = IMPACTS.map((i) => ({ value: i, label: i[0].toUpperCase() + i.slice(1) }));
const QUICK_PRESETS = FUSE_PRESETS.filter((p) => ["today", "tomorrow", "this_week"].includes(p.value));
const OTHER_PRESETS = FUSE_PRESETS.filter((p) => !["today", "tomorrow", "this_week"].includes(p.value));

const schema = z
  .object({
    title: z.string().trim().min(1, "Tell us what needs to be done.").max(200),
    notes: z.string().max(5000),
    fuse: z.enum(FUSE_PRESETS.map((p) => p.value) as [FusePreset, ...FusePreset[]]),
    custom: z.string(),
    impact: z.enum(IMPACTS),
    bother: z.enum(["now", "later"]),
    botherAt: z.string(),
  })
  .superRefine((v, ctx) => {
    const now = getNow();
    const deadline = deadlineFor(v);
    if (!deadline || Number.isNaN(deadline.getTime())) ctx.addIssue({ code: "custom", path: ["custom"], message: "Pick a date and time." });
    else if (deadline.getTime() <= now + 60_000) ctx.addIssue({ code: "custom", path: ["custom"], message: "That moment has already passed." });
    if (v.bother === "later") {
      const b = new Date(v.botherAt).getTime();
      if (Number.isNaN(b)) ctx.addIssue({ code: "custom", path: ["botherAt"], message: "Pick when to start bothering you." });
      else if (deadline && b >= deadline.getTime()) ctx.addIssue({ code: "custom", path: ["botherAt"], message: "It has to be before the deadline." });
    }
  });
type Values = z.infer<typeof schema>;

function deadlineFor(v: Pick<Values, "fuse" | "custom">): Date | null {
  if (v.fuse === "custom") return v.custom ? new Date(v.custom) : null;
  return resolveFusePreset(v.fuse, new Date(getNow()));
}

const defaults = (): Values => ({
  title: "",
  notes: "",
  fuse: resolveFusePreset("today", new Date(getNow())).getTime() > getNow() + 60_000 ? "today" : "tomorrow",
  custom: toLocalInput(new Date(getNow() + 24 * 3_600_000)),
  impact: "normal",
  bother: "now",
  botherAt: toLocalInput(new Date(getNow() + 3_600_000)),
});

export function CreateTaskDialog({
  open,
  onOpenChange,
  position,
  onCreated,
  disabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  position: { x: number; y: number };
  onCreated: (taskId: string) => void;
  disabled?: boolean;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [moreOptions, setMoreOptions] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const { register, control, handleSubmit, watch, formState, reset } = form;
  const fuse = watch("fuse");
  const bother = watch("bother");
  const custom = watch("custom");
  const deadlinePreview = deadlineFor({ fuse, custom });

  const onSubmit = handleSubmit(async (v) => {
    setSubmitError(null);
    const deadline = deadlineFor(v)!;
    const res = await createTask({
      title: v.title,
      notes: v.notes || undefined,
      impact: v.impact as Impact,
      deadlineAt: deadline.toISOString(),
      botherAfter: v.bother === "later" ? new Date(v.botherAt).toISOString() : null,
      fusePreset: v.fuse,
      x: position.x,
      y: position.y,
    });
    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    toast.success("Fuse lit.", { description: v.title });
    reset(defaults());
    setMoreOptions(false);
    onOpenChange(false);
    onCreated(String(res.data?.taskId));
  }, (errors) => {
    if (errors.notes || errors.botherAt || errors.custom) setMoreOptions(true);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) { reset(defaults()); setSubmitError(null); setMoreOptions(false); }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">New task</DialogTitle>
          <DialogDescription>It starts small. It won&apos;t stay that way.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="task-title" className="text-sm font-semibold">
              What needs to be done?
            </Label>
            <Input id="task-title" autoFocus maxLength={200} enterKeyHint="done" className="text-base" placeholder="Send the proposal to Marta" aria-invalid={!!formState.errors.title} {...register("title")} />
            <FieldError message={formState.errors.title?.message} />
          </div>

          <Controller
            control={control}
            name="fuse"
            render={({ field }) => (
              <ChoiceGroup legend="When is it due?" name="fuse" options={QUICK_PRESETS} columns={3} value={field.value} onChange={field.onChange} />
            )}
          />
          {deadlinePreview && !Number.isNaN(deadlinePreview.getTime()) && <p className="text-xs text-muted-foreground">Due {format(deadlinePreview, "EEEE, dd MMM, HH:mm")} · your local time</p>}
          <Button type="button" variant="outline" className="w-full" aria-expanded={moreOptions} aria-controls="new-task-options" onClick={() => setMoreOptions((value) => !value)}>
            {moreOptions ? "Fewer options" : "More options"}
          </Button>
          <div id="new-task-options" hidden={!moreOptions} className="space-y-6">
          <Controller control={control} name="fuse" render={({ field }) => (
            <ChoiceGroup legend="Other deadlines" name="other-fuse" options={OTHER_PRESETS} value={field.value} onChange={field.onChange} />
          )} />
          <div className="space-y-2">
            <Label htmlFor="task-notes" className="text-sm font-semibold">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="task-notes" rows={2} maxLength={5000} {...register("notes")} />
            <FieldError message={formState.errors.notes?.message} />
          </div>
          {fuse === "custom" && (
            <Controller
              control={control}
              name="custom"
              render={({ field }) => (
                <DateTimeField label="Custom deadline" value={field.value} onChange={field.onChange} error={formState.errors.custom?.message} />
              )}
            />
          )}

          <Controller
            control={control}
            name="impact"
            render={({ field }) => (
              <ChoiceGroup
                legend="Impact if you don't do it"
                name="impact"
                options={IMPACT_OPTIONS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />

          <Controller
            control={control}
            name="bother"
            render={({ field }) => (
              <ChoiceGroup
                legend="Start bothering me"
                description="Until then the card stays quiet. The fuse burns either way."
                name="bother"
                columns={2}
                options={[
                  { value: "now", label: "Immediately" },
                  { value: "later", label: "Choose date" },
                ]}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          {bother === "later" && (
            <Controller
              control={control}
              name="botherAt"
              render={({ field }) => (
                <DateTimeField label="Start bothering me at" value={field.value} onChange={field.onChange} error={formState.errors.botherAt?.message} />
              )}
            />
          )}
          </div>
          {!moreOptions && (fuse === "custom" || bother === "later" || watch("impact") !== "normal" || !!watch("notes")) && <p className="text-xs text-muted-foreground">Your additional options are kept. Open More options to review them.</p>}
          {(fuse !== "custom" || !moreOptions) && <FieldError message={formState.errors.custom?.message} />}
          {!moreOptions && <FieldError message={formState.errors.botherAt?.message} />}

          {submitError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full tracking-[0.2em]" disabled={formState.isSubmitting || disabled}>
            {formState.isSubmitting ? "LIGHTING…" : "LIGHT THE FUSE"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
