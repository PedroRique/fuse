import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  getEffectiveDeadline,
  getEffectiveElapsedMs,
  getPausedMsBetween,
  getProgress,
  getRemainingMs,
  isPausedAt,
} from "./time";
import type { BoardPause } from "./types";

const H = 3_600_000;
const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();
const fuse = (hours: number) => ({ fuseStartedAt: iso(T0), deadlineAt: iso(T0 + hours * H) });
const pause = (start: number, hours: number, endedAfterHours?: number): BoardPause => ({
  id: String(start),
  reason: "r",
  startedAt: iso(start),
  plannedEndAt: iso(start + hours * H),
  endedAt: endedAfterHours === undefined ? null : iso(start + endedAfterHours * H),
});

describe("progress and remaining", () => {
  it("is 0 before and at fuse start", () => {
    expect(getProgress(fuse(2), [], T0 - H)).toBe(0);
    expect(getProgress(fuse(2), [], T0)).toBe(0);
    expect(getRemainingMs(fuse(2), [], T0 - H)).toBe(2 * H);
  });

  it("is linear in effective time and clamps at 1", () => {
    expect(getProgress(fuse(2), [], T0 + H)).toBe(0.5);
    expect(getRemainingMs(fuse(2), [], T0 + H)).toBe(H);
    expect(getProgress(fuse(2), [], T0 + 2 * H)).toBe(1);
    expect(getRemainingMs(fuse(2), [], T0 + 2 * H)).toBe(0);
    expect(getProgress(fuse(2), [], T0 + 5 * H)).toBe(1);
    expect(getRemainingMs(fuse(2), [], T0 + 5 * H)).toBe(-3 * H);
  });

  it("treats a zero-length fuse as fully burned", () => {
    expect(getProgress({ fuseStartedAt: iso(T0), deadlineAt: iso(T0) }, [], T0)).toBe(1);
  });

  it("does not depend on the runtime timezone", () => {
    const original = process.env.TZ;
    const results = ["UTC", "America/Sao_Paulo", "Asia/Tokyo", "Pacific/Kiritimati"].map((tz) => {
      process.env.TZ = tz;
      return [getProgress(fuse(10), [], T0 + 3 * H), getRemainingMs(fuse(10), [], T0 + 3 * H)];
    });
    process.env.TZ = original;
    for (const r of results) expect(r).toEqual(results[0]);
  });
});

describe("pauses", () => {
  it("excludes active pause time from elapsed", () => {
    const p = [pause(T0 + H, 6)];
    expect(getEffectiveElapsedMs(fuse(10), p, T0 + 3 * H)).toBe(H);
    expect(isPausedAt(p, T0 + 3 * H)).toBe(true);
  });

  it("uses the planned end when the pause ran its course", () => {
    const p = [pause(T0 + H, 2)];
    expect(getEffectiveElapsedMs(fuse(10), p, T0 + 5 * H)).toBe(3 * H);
    expect(isPausedAt(p, T0 + 5 * H)).toBe(false);
  });

  it("uses the actual end when a pause was ended early", () => {
    const p = [pause(T0 + H, 6, 1)];
    expect(getEffectiveElapsedMs(fuse(10), p, T0 + 5 * H)).toBe(4 * H);
  });

  it("ignores pause time before the fuse was lit", () => {
    const p = [pause(T0 - 2 * H, 3)];
    expect(getEffectiveElapsedMs(fuse(10), p, T0 + 2 * H)).toBe(H);
  });

  it("merges overlapping pauses instead of double counting", () => {
    const p = [pause(T0 + H, 2), pause(T0 + 2 * H, 2)];
    expect(getPausedMsBetween(p, T0, T0 + 10 * H)).toBe(3 * H);
  });

  it("pushes the effective deadline by the paused time", () => {
    const p = [pause(T0 + H, 2)];
    expect(getEffectiveDeadline(fuse(4), p, T0 + 5 * H)).toBe(T0 + 6 * H);
    expect(getRemainingMs(fuse(4), p, T0 + 6 * H)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "00:00:00"],
    [-5000, "00:00:00"],
    [999, "00:00:01"],
    [14 * 60_000 + 32_000, "00:14:32"],
    [2 * H, "02:00:00"],
    [3 * 24 * H + 4 * H + 5000, "3d 04:00:05"],
  ])("%s ms → %s", (msValue, out) => expect(formatCountdown(msValue)).toBe(out));
});
