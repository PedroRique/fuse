"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceGroup, FieldError } from "@/components/choice-group";
import { useOnline } from "@/lib/use-online";
import { MIN_EXPLANATION_LENGTH, PAUSE_OPTIONS_HOURS } from "@/domain/rules";
import { startPause } from "@/server/actions";

const OPTIONS = PAUSE_OPTIONS_HOURS.map((h) => ({ value: String(h), label: `${h} hours` }));

export function EmergencyPauseDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const online = useOnline();
  const [hours, setHours] = useState<string>();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!hours) errs.hours = "How long do you need?";
    if (reason.trim().length < MIN_EXPLANATION_LENGTH) errs.reason = "Tell yourself what's going on.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    setSubmitError(null);
    const res = await startPause({ hours: Number(hours), reason });
    setPending(false);
    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    toast("Board paused.", { description: "Every fuse is frozen." });
    setHours(undefined);
    setReason("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-6" noValidate>
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Emergency pause</DialogTitle>
            <DialogDescription>
              Life happens. Every fuse on your board freezes: nothing grows, nothing explodes.
            </DialogDescription>
          </DialogHeader>
          <ChoiceGroup legend="For how long?" name="pause-hours" options={OPTIONS} value={hours} onChange={setHours} error={errors.hours} />
          <div className="space-y-2">
            <Label htmlFor="pause-reason" className="text-sm font-semibold">
              What&apos;s going on?
            </Label>
            <Textarea id="pause-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason} />
            <FieldError message={errors.reason} />
          </div>
          {submitError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full tracking-[0.2em]" disabled={pending || !online}>
            {pending ? "PAUSING…" : "PAUSE THE BOARD"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
