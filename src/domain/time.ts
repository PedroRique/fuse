import type { BoardPause, Task } from "./types";

const ms = (iso: string) => new Date(iso).getTime();

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export const isPausedAt = (pauses: readonly BoardPause[], now: number) =>
  pauses.some((p) => ms(p.startedAt) <= now && now < pauseEnd(p));

export const getActivePause = (pauses: readonly BoardPause[], now: number) =>
  pauses.find((p) => ms(p.startedAt) <= now && now < pauseEnd(p)) ?? null;

const pauseEnd = (p: BoardPause) =>
  p.endedAt ? Math.min(ms(p.endedAt), ms(p.plannedEndAt)) : ms(p.plannedEndAt);

/** Total paused milliseconds that overlap [from, to]. Overlapping pauses are merged. */
export function getPausedMsBetween(
  pauses: readonly BoardPause[],
  from: number,
  to: number,
): number {
  const windows = pauses
    .map((p) => [Math.max(ms(p.startedAt), from), Math.min(pauseEnd(p), to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = -Infinity;
  for (const [s, e] of windows) {
    const start = Math.max(s, cursor);
    if (e > start) total += e - start;
    cursor = Math.max(cursor, e);
  }
  return total;
}

type FuseTimes = Pick<Task, "fuseStartedAt" | "deadlineAt">;

export const getFuseMs = (t: FuseTimes) => ms(t.deadlineAt) - ms(t.fuseStartedAt);

/** Burned fuse time, excluding emergency pauses. */
export function getEffectiveElapsedMs(
  t: FuseTimes,
  pauses: readonly BoardPause[],
  now: number,
): number {
  const start = ms(t.fuseStartedAt);
  if (now <= start) return 0;
  return now - start - getPausedMsBetween(pauses, start, now);
}

export function getRemainingMs(t: FuseTimes, pauses: readonly BoardPause[], now: number) {
  return getFuseMs(t) - getEffectiveElapsedMs(t, pauses, now);
}

export function getProgress(t: FuseTimes, pauses: readonly BoardPause[], now: number) {
  const total = getFuseMs(t);
  if (total <= 0) return 1;
  return clamp(getEffectiveElapsedMs(t, pauses, now) / total, 0, 1);
}

/** Wall-clock moment the fuse ends, given pauses known so far. */
export function getEffectiveDeadline(
  t: FuseTimes,
  pauses: readonly BoardPause[],
  now: number,
): number {
  return now + getRemainingMs(t, pauses, now);
}

/** "00:14:32", or "3d 04:12:09" when more than a day remains. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  return d > 0 ? `${d}d ${hms}` : hms;
}

/** Coarse human duration: "2 hours", "3 days", "45 min". */
export function formatDuration(msValue: number): string {
  const abs = Math.abs(msValue);
  const min = Math.round(abs / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(abs / 3_600_000);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(abs / 86_400_000);
  return `${d} days`;
}
