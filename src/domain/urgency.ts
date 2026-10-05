import type { BoardPause, Task } from "./types";
import { clamp, getEffectiveElapsedMs, getFuseMs, getProgress, getRemainingMs, isPausedAt } from "./time";

export const URGENCY = {
  /** Progress where growth starts to register at all. */
  curveStart: 0.45,
  /** Curve steepness: higher = more of the growth packed near the deadline. */
  steepness: 4,
  /** Absolute max scale at 100%. The UI may clamp further to fit the viewport. */
  maxScale: 3.4,
  activeAt: 0.5,
  warningAt: 0.75,
  criticalAt: 0.9,
  finalCountdownAt: 0.95,
} as const;

export type TemporalStateName = "safe" | "active" | "warning" | "critical" | "exploded";

/**
 * Smooth exponential ease from curveStart to 1.
 * ~1.02 at 50%, ~1.35 at 75%, ~2.1 at 90%, maxScale at 100%.
 */
export function getUrgencyScale(progress: number): number {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const x = clamp((p - URGENCY.curveStart) / (1 - URGENCY.curveStart), 0, 1);
  const k = URGENCY.steepness;
  const eased = (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
  return 1 + (URGENCY.maxScale - 1) * eased;
}

/** 0..1 visual "temperature", used for color/border intensity. */
export const getHeat = (progress: number) => clamp((progress - URGENCY.activeAt) / (1 - URGENCY.activeAt), 0, 1);

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

  return {
    ...base,
    state: getStateForProgress(progress),
    scale: getUrgencyScale(progress),
    heat: getHeat(progress),
    isDormant,
    isFinalCountdown: progress >= URGENCY.finalCountdownAt,
  };
}
