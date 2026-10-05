import { describe, expect, it } from "vitest";
import { getHeat, getStateForProgress, getTaskTemporalState, getUrgencyScale, URGENCY } from "./urgency";
import type { BoardPause } from "./types";

const H = 3_600_000;
const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();
const task = (fuseMs = 100 * H, extra: Partial<{ botherAfter: string; status: "active" | "exploded" }> = {}) => ({
  fuseStartedAt: iso(T0),
  deadlineAt: iso(T0 + fuseMs),
  botherAfter: extra.botherAfter ?? null,
  status: extra.status ?? ("active" as const),
});
const at = (pct: number) => T0 + pct * 100 * H;

describe("getUrgencyScale", () => {
  const points = [0, 0.49, 0.5, 0.74, 0.75, 0.89, 0.9, 0.95, 0.999, 1, 1.5];
  const scales = points.map(getUrgencyScale);

  it("is monotonic non-decreasing", () => {
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1]);
  });

  it("is almost imperceptible until 50%", () => {
    expect(getUrgencyScale(0)).toBe(1);
    expect(getUrgencyScale(0.49)).toBeLessThan(1.02);
    expect(getUrgencyScale(0.5)).toBeLessThan(1.03);
  });

  it("starts to show between 50% and 75%", () => {
    expect(getUrgencyScale(0.74)).toBeGreaterThan(1.2);
    expect(getUrgencyScale(0.75)).toBeLessThan(1.5);
  });

  it("grows evidently from 75% to 90%", () => {
    expect(getUrgencyScale(0.89) - getUrgencyScale(0.75)).toBeGreaterThan(0.5);
  });

  it("grows aggressively in the last 10%", () => {
    const late = getUrgencyScale(1) - getUrgencyScale(0.9);
    const mid = getUrgencyScale(0.9) - getUrgencyScale(0.75);
    expect(late).toBeGreaterThan(mid);
    expect(getUrgencyScale(0.95)).toBeGreaterThan(2.5);
    expect(getUrgencyScale(0.999)).toBeCloseTo(URGENCY.maxScale, 1);
  });

  it("is capped at maxScale and handles out-of-range input", () => {
    expect(getUrgencyScale(1)).toBe(URGENCY.maxScale);
    expect(getUrgencyScale(7)).toBe(URGENCY.maxScale);
    expect(getUrgencyScale(-1)).toBe(1);
    expect(getUrgencyScale(NaN)).toBe(1);
  });

  it("is smooth (no jumps between neighbouring points)", () => {
    for (let p = 0; p < 1; p += 0.001) {
      expect(getUrgencyScale(p + 0.001) - getUrgencyScale(p)).toBeLessThan(0.02);
    }
  });
});

describe("states and heat", () => {
  it.each([
    [0, "safe"],
    [0.49, "safe"],
    [0.5, "active"],
    [0.74, "active"],
    [0.75, "warning"],
    [0.89, "warning"],
    [0.9, "critical"],
    [0.999, "critical"],
    [1, "critical"],
  ])("progress %s → %s", (p, s) => expect(getStateForProgress(p)).toBe(s));

  it("heat starts at 50%", () => {
    expect(getHeat(0.4)).toBe(0);
    expect(getHeat(0.75)).toBeCloseTo(0.5);
    expect(getHeat(1)).toBe(1);
  });
});

describe("getTaskTemporalState", () => {
  it.each([
    [0, "safe", false],
    [0.49, "safe", false],
    [0.5, "active", false],
    [0.74, "active", false],
    [0.75, "warning", false],
    [0.89, "warning", false],
    [0.9, "critical", false],
    [0.95, "critical", true],
    [0.999, "critical", true],
  ] as const)("at %s%% of the fuse → %s (final countdown: %s)", (pct, state, final) => {
    const s = getTaskTemporalState(task(), [], at(pct));
    expect(s.state).toBe(state);
    expect(s.isFinalCountdown).toBe(final);
    expect(s.progress).toBeCloseTo(pct);
  });

  it("explodes exactly at 100% and beyond", () => {
    expect(getTaskTemporalState(task(), [], at(1)).state).toBe("exploded");
    expect(getTaskTemporalState(task(), [], at(1) - 1).state).toBe("critical");
    const late = getTaskTemporalState(task(), [], at(1.4));
    expect(late.state).toBe("exploded");
    expect(late.progress).toBe(1);
    expect(late.remainingMs).toBeLessThan(0);
  });

  it("stays dormant before botherAfter, then escalates normally", () => {
    const t = task(100 * H, { botherAfter: iso(at(0.92)) });
    const before = getTaskTemporalState(t, [], at(0.91));
    expect(before.isDormant).toBe(true);
    expect(before.scale).toBe(1);
    expect(before.state).toBe("safe");
    expect(before.progress).toBeCloseTo(0.91);

    const after = getTaskTemporalState(t, [], at(0.92));
    expect(after.isDormant).toBe(false);
    expect(after.state).toBe("critical");
  });

  it("dormancy never prevents an explosion", () => {
    const t = task(100 * H, { botherAfter: iso(at(2)) });
    expect(getTaskTemporalState(t, [], at(1)).state).toBe("exploded");
  });

  it("freezes during an emergency pause", () => {
    const pause: BoardPause = {
      id: "p",
      reason: "x",
      startedAt: iso(at(0.9)),
      plannedEndAt: iso(at(0.9) + 24 * H),
      endedAt: null,
    };
    const a = getTaskTemporalState(task(), [pause], at(0.9) + H);
    const b = getTaskTemporalState(task(), [pause], at(0.9) + 20 * H);
    expect(a.isPaused).toBe(true);
    expect(a.progress).toBeCloseTo(0.9);
    expect(b.remainingMs).toBe(a.remainingMs);
    // 20h of wall time past the raw deadline, still alive thanks to the pause.
    expect(getTaskTemporalState(task(), [pause], at(1) + 10 * H).state).toBe("critical");
  });

  it("reports exploded status regardless of time", () => {
    expect(getTaskTemporalState(task(100 * H, { status: "exploded" }), [], at(0.1)).state).toBe("exploded");
  });
});
