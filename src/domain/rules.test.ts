import { describe, expect, it } from "vitest";
import { CRITICAL_EDIT_THRESHOLD, isExplosionDue, judgeDeadlineEdit, storedDeadlineFor } from "./rules";
import { getScarLevel, showsExplosionCounter, describeExplosions } from "./scars";
import { resolveExtension, resolveFusePreset } from "./presets";
import { BOARD, clampToBoard, getBoardState, getNextFreeSlot, getStagingPositions, isInsideBoard } from "./board";
import type { BoardPause } from "./types";
import { getEffectiveDeadline } from "./time";

const H = 3_600_000;
const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();
const task = { fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 100 * H), status: "active" as const };
const at = (pct: number) => T0 + pct * 100 * H;

describe("explosion eligibility", () => {
  it("is due only for active tasks with no time left", () => {
    expect(isExplosionDue(task, [], at(0.999))).toBe(false);
    expect(isExplosionDue(task, [], at(1))).toBe(true);
    expect(isExplosionDue(task, [], at(3))).toBe(true);
    expect(isExplosionDue({ ...task, status: "completed" }, [], at(3))).toBe(false);
    expect(isExplosionDue({ ...task, status: "exploded" }, [], at(3))).toBe(false);
  });

  it("is not due while a pause keeps the fuse alive", () => {
    const pause: BoardPause = { id: "p", reason: "r", startedAt: iso(at(0.9)), plannedEndAt: iso(at(0.9) + 24 * H), endedAt: null };
    expect(isExplosionDue(task, [pause], at(1) + H)).toBe(false);
  });
});

describe("deadline edit threshold", () => {
  const later = T0 + 200 * H;
  const sooner = T0 + 95 * H;

  it("allows extending below the threshold", () => {
    expect(judgeDeadlineEdit(task, [], at(0.74), later).kind).toBe("allowed");
  });

  it("requires a wire cut to extend at or above the threshold", () => {
    expect(CRITICAL_EDIT_THRESHOLD).toBe(0.75);
    expect(judgeDeadlineEdit(task, [], at(0.75), later).kind).toBe("requires_wire_cut");
    expect(judgeDeadlineEdit(task, [], at(0.99), later).kind).toBe("requires_wire_cut");
  });

  it("always allows shortening into the future", () => {
    expect(judgeDeadlineEdit(task, [], at(0.9), sooner).kind).toBe("allowed");
  });

  it("rejects deadlines in the past and edits after expiry", () => {
    expect(judgeDeadlineEdit(task, [], at(0.9), T0 + 50 * H).kind).toBe("invalid");
    expect(judgeDeadlineEdit(task, [], at(1), later).kind).toBe("invalid");
    expect(judgeDeadlineEdit({ ...task, status: "completed" }, [], at(0.1), later).kind).toBe("invalid");
  });

  it("maps a wall-clock target back to the stored deadline across pauses", () => {
    const pause: BoardPause = { id: "p", reason: "r", startedAt: iso(T0 + H), plannedEndAt: iso(T0 + 3 * H), endedAt: null };
    const now = T0 + 5 * H;
    const desired = T0 + 150 * H;
    const stored = storedDeadlineFor(task, [pause], now, desired);
    expect(stored).toBe(T0 + 148 * H);
    expect(getEffectiveDeadline({ ...task, deadlineAt: iso(stored) }, [pause], now)).toBe(desired);
  });
});

describe("scars", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [7, 4],
    [-1, 0],
  ])("%s explosions → level %s", (count, level) => expect(getScarLevel(count)).toBe(level));

  it("shows a counter from 4 explosions", () => {
    expect(showsExplosionCounter(3)).toBe(false);
    expect(showsExplosionCounter(4)).toBe(true);
    expect(describeExplosions(0)).toBe("without explosions");
    expect(describeExplosions(2)).toBe("after 2 explosions");
  });
});

describe("presets and timezones", () => {
  const withTz = <T>(tz: string, fn: () => T): T => {
    const original = process.env.TZ;
    process.env.TZ = tz;
    try {
      return fn();
    } finally {
      process.env.TZ = original;
    }
  };

  it("2 hours is absolute", () => {
    const now = new Date(T0);
    expect(resolveFusePreset("2h", now).getTime()).toBe(T0 + 2 * H);
  });

  it("'Today' ends at local midnight in the user's timezone", () => {
    // 2026-03-01T10:00Z is 07:00 in São Paulo and 19:00 in Tokyo.
    const sp = withTz("America/Sao_Paulo", () => resolveFusePreset("today", new Date(T0)).toISOString());
    const tokyo = withTz("Asia/Tokyo", () => resolveFusePreset("today", new Date(T0)).toISOString());
    expect(sp).toBe("2026-03-02T02:59:59.999Z");
    expect(tokyo).toBe("2026-03-01T14:59:59.999Z");
  });

  it("'1 week' keeps wall-clock time across a DST change", () => {
    // US DST starts 2026-03-08.
    const out = withTz("America/New_York", () => {
      const start = new Date("2026-03-05T09:00:00-05:00");
      return resolveFusePreset("1w", start).getTime() - start.getTime();
    });
    expect(out).toBe(7 * 24 * H - H);
  });

  it("extensions add on top of the remaining time", () => {
    const deadline = new Date(T0 + 2 * H);
    expect(resolveExtension("30m", deadline, new Date(T0)).getTime()).toBe(T0 + 2.5 * H);
    const tomorrow = withTz("UTC", () => resolveExtension("tomorrow", deadline, new Date(T0)).toISOString());
    expect(tomorrow).toBe("2026-03-02T23:59:59.999Z");
  });
});

describe("board geometry", () => {
  it("derives board state with incident precedence", () => {
    const pause: BoardPause = { id: "p", reason: "r", startedAt: iso(T0), plannedEndAt: iso(T0 + H), endedAt: null };
    expect(getBoardState(null, [], T0)).toBe("active");
    expect(getBoardState(null, [pause], T0 + 1)).toBe("paused");
    expect(getBoardState({ phase: "post_mortem" }, [pause], T0 + 1)).toBe("destroyed");
    expect(getBoardState({ phase: "rebuilding" }, [], T0)).toBe("rebuilding");
    expect(getBoardState({ phase: "resolved" }, [], T0)).toBe("active");
  });

  it("puts staging positions outside the board, deterministically", () => {
    const ids = Array.from({ length: 14 }, (_, i) => `task-${i}`);
    const a = getStagingPositions(ids);
    expect(getStagingPositions(ids)).toEqual(a);
    for (const id of ids) expect(isInsideBoard(a[id].x, a[id].y)).toBe(false);
  });

  it("clamps and finds free slots", () => {
    expect(clampToBoard(-50, 99999)).toEqual({ x: 110, y: BOARD.height - 60 });
    const first = getNextFreeSlot([]);
    const second = getNextFreeSlot([first]);
    expect(second).not.toEqual(first);
    expect(isInsideBoard(second.x, second.y)).toBe(true);
  });
});
