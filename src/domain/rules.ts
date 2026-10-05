import type { BoardPause, Task } from "./types";
import { getEffectiveDeadline, getProgress, getRemainingMs } from "./time";

/** From this fuse progress on, extending the deadline requires cutting the wire. Mirrored in SQL. */
export const CRITICAL_EDIT_THRESHOLD = 0.75;

export const MAX_PAUSE_HOURS = 24;
export const PAUSE_OPTIONS_HOURS = [2, 6, 12, 24] as const;

export const MIN_EXPLANATION_LENGTH = 3;

type FuseTask = Pick<Task, "fuseStartedAt" | "deadlineAt" | "status">;

export function isExplosionDue(task: FuseTask, pauses: readonly BoardPause[], now: number) {
  return task.status === "active" && getRemainingMs(task, pauses, now) <= 0;
}

export type DeadlineEditVerdict =
  | { kind: "allowed" }
  | { kind: "requires_wire_cut" }
  | { kind: "invalid"; message: string };

/**
 * Free edits are allowed while the fuse is young, or when shortening.
 * Extending a well-burned fuse must go through Cut the Wire.
 */
export function judgeDeadlineEdit(
  task: FuseTask,
  pauses: readonly BoardPause[],
  now: number,
  newDeadlineMs: number,
): DeadlineEditVerdict {
  if (task.status !== "active") return { kind: "invalid", message: "Only active tasks can be rescheduled." };
  if (isExplosionDue(task, pauses, now)) return { kind: "invalid", message: "This fuse already ran out." };
  const current = new Date(task.deadlineAt).getTime();
  if (newDeadlineMs <= new Date(task.fuseStartedAt).getTime()) {
    return { kind: "invalid", message: "The deadline must be after the fuse was lit." };
  }
  // Effective deadline after the change must still be in the future.
  if (getEffectiveDeadline(task, pauses, now) + (newDeadlineMs - current) <= now) {
    return { kind: "invalid", message: "Pick a moment in the future." };
  }
  if (newDeadlineMs <= current) return { kind: "allowed" };
  if (getProgress(task, pauses, now) >= CRITICAL_EDIT_THRESHOLD) return { kind: "requires_wire_cut" };
  return { kind: "allowed" };
}

/**
 * Converts a desired wall-clock end into the stored deadline,
 * which excludes time already spent paused within the fuse.
 */
export function storedDeadlineFor(
  task: Pick<Task, "fuseStartedAt" | "deadlineAt">,
  pauses: readonly BoardPause[],
  now: number,
  desiredEndMs: number,
): number {
  const current = new Date(task.deadlineAt).getTime();
  return current + (desiredEndMs - getEffectiveDeadline(task, pauses, now));
}
