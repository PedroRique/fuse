import { z } from "zod";
import { IMPACTS, WHAT_HAPPENED } from "@/domain/types";
import { PAUSE_OPTIONS_HOURS, MIN_EXPLANATION_LENGTH } from "@/domain/rules";

const id = z.uuid();
const iso = z.iso.datetime({ offset: true });
const coord = z.number().int().min(-10_000).max(10_000);
const reason = z.enum(WHAT_HAPPENED.map((w) => w.value) as [string, ...string[]]);
const explanation = z.string().trim().min(MIN_EXPLANATION_LENGTH, "Write a few words.").max(2000);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Tell us what needs to be done.").max(200),
  notes: z.string().max(5000).optional(),
  impact: z.enum(IMPACTS),
  deadlineAt: iso,
  botherAfter: iso.nullable(),
  fusePreset: z.string().max(20),
  x: coord,
  y: coord,
});

export const updateContentSchema = z.object({
  taskId: id,
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).optional(),
  impact: z.enum(IMPACTS),
});

export const moveSchema = z.object({ taskId: id, x: coord, y: coord });
export const taskIdSchema = z.object({ taskId: id });
export const rescheduleSchema = z.object({ taskId: id, newEnd: iso });

export const cutWireSchema = z.object({ taskId: id, reason, explanation, newEnd: iso });

export const pauseSchema = z.object({
  hours: z.number().refine((h) => (PAUSE_OPTIONS_HOURS as readonly number[]).includes(h), "Pick a duration."),
  reason: z.string().trim().min(MIN_EXPLANATION_LENGTH, "Tell yourself why.").max(500),
});

export const postMortemSchema = z
  .object({
    taskId: id,
    reason,
    explanation,
    resolution: z.enum(["complete", "reschedule", "discard"]),
    newEnd: iso.nullable(),
    discardReason: z.string().trim().max(2000).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.resolution === "reschedule" && !v.newEnd) ctx.addIssue({ code: "custom", path: ["newEnd"], message: "Pick a new deadline." });
    if (v.resolution === "discard" && (v.discardReason ?? "").length < MIN_EXPLANATION_LENGTH)
      ctx.addIssue({ code: "custom", path: ["discardReason"], message: "Why is this task no longer necessary?" });
  });

export const restoreSchema = z.object({ taskId: id, x: coord, y: coord });
