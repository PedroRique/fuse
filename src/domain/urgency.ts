import type { BoardPause, Task } from "./types";
import { clamp, getEffectiveElapsedMs, getFuseMs, getProgress, getRemainingMs, isPausedAt } from "./time";

export const URGENCY = {
  /** Growth starts as soon as the fuse lights, so two cards with different % never look the same size. */
  curveStart: 0,
  /** Curve steepness: still eases up near the deadline, but the mid-fuse is readable. */
  steepness: 3.2,
  /** Absolute max scale at 100%. The UI may clamp further to fit the viewport. */
  maxScale: 3.4,
  activeAt: 0.5,
  warningAt: 0.75,
  criticalAt: 0.9,
  finalCountdownAt: 0.95,
} as const;

export type TemporalStateName = "safe" | "active" | "warning" | "critical" | "exploded";

/**
 * Smooth exponential ease from the first tick.
 * ~1.13 at 25%, ~1.40 at 50%, ~2.02 at 75%, ~2.71 at 90%, maxScale at 100%.
 */
export function getUrgencyScale(progress: number): number {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const span = 1 - URGENCY.curveStart;
  const x = clamp(span <= 0 ? 1 : (p - URGENCY.curveStart) / span, 0, 1);
  const k = URGENCY.steepness;
  const eased = (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
  return 1 + (URGENCY.maxScale - 1) * eased;
}

/** 0..1 visual "temperature". Tracks burned % from the first tick so color is never "all white". */
export const getHeat = (progress: number) => clamp(Number.isFinite(progress) ? progress : 0, 0, 1);

const HOUR = 3_600_000;

/**
 * Absolute time left also takes space. A 3-day fuse that just lit is more urgent
 * than a 3-month fuse that just lit, even though both are at 0% burned.
 * Half-life ~36h so 3 days still reads, a month is nearly scale 1.
 */
export function getDeadlinePressure(remainingMs: number): { scale: number; heat: number } {
  if (!Number.isFinite(remainingMs)) return { scale: 1, heat: 0 };
  if (remainingMs <= 0) return { scale: URGENCY.maxScale, heat: 1 };
  const p = 1 / (1 + remainingMs / HOUR / 36);
  return {
    scale: 1 + (URGENCY.maxScale - 1) * p ** 1.15 * 0.48,
    heat: p ** 1.1 * 0.55,
  };
}

export function getStateForProgress(progress: number): Exclude<TemporalStateName, "exploded"> {
  if (progress >= URGENCY.criticalAt) return "critical";
  if (progress >= URGENCY.warningAt) return "warning";
  if (progress >= URGENCY.activeAt) return "active";
  return "safe";
}

export type TaskTemporalState = {
  progress: number;
  remainingMs: number;
  elapsedMs: number;
  fuseMs: number;
  state: TemporalStateName;
  /** Visual scale; 1 while dormant. */
  scale: number;
  heat: number;
  isDormant: boolean;
  isFinalCountdown: boolean;
  isPaused: boolean;
};

type TemporalTask = Pick<Task, "fuseStartedAt" | "deadlineAt" | "botherAfter" | "status">;

export function getTaskTemporalState(
  task: TemporalTask,
  pauses: readonly BoardPause[],
  now: number,
): TaskTemporalState {
  const progress = getProgress(task, pauses, now);
  const remainingMs = getRemainingMs(task, pauses, now);
  const base = {
    progress,
    remainingMs,
    elapsedMs: getEffectiveElapsedMs(task, pauses, now),
    fuseMs: getFuseMs(task),
    isPaused: isPausedAt(pauses, now),
  };

  if (task.status === "exploded" || (task.status === "active" && remainingMs <= 0)) {
    return { ...base, state: "exploded", scale: URGENCY.maxScale, heat: 1, isDormant: false, isFinalCountdown: false };
  }

  const isDormant = !!task.botherAfter && now < new Date(task.botherAfter).getTime();
  if (isDormant) {
    return { ...base, state: "safe", scale: 1, heat: 0, isDormant, isFinalCountdown: false };
  }

  const pressure = getDeadlinePressure(remainingMs);
  return {
    ...base,
    state: getStateForProgress(progress),
    scale: Math.max(getUrgencyScale(progress), pressure.scale),
    heat: Math.max(getHeat(progress), pressure.heat),
    isDormant,
    isFinalCountdown: progress >= URGENCY.finalCountdownAt,
  };
}
