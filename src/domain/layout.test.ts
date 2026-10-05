import { describe, expect, it } from "vitest";
import { BOARD, CARD } from "./board";
import { packCards, readingOrder, sortTasks, visualSize, type BoardSort } from "./layout";
import type { Task } from "./types";

const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();

function task(partial: Partial<Task> & Pick<Task, "id" | "impact" | "deadlineAt" | "fuseStartedAt">): Task {
  return {
    userId: "u",
    boardId: "b",
    title: partial.id,
    notes: null,
    createdAt: iso(T0),
    botherAfter: null,
    status: "active",
    explosionCount: 0,
    completedAt: null,
    discardedAt: null,
    positionX: 400,
    positionY: 400,
    updatedAt: iso(T0),
    ...partial,
  };
}

describe("packCards", () => {
  it("places a single card fully inside the board", () => {
    const pos = packCards([{ id: "a", scale: 1 }]);
    const { w, h } = visualSize(1);
    expect(pos.a.x - w / 2).toBeGreaterThanOrEqual(0);
    expect(pos.a.x + w / 2).toBeLessThanOrEqual(BOARD.width);
    expect(pos.a.y - h / 2).toBeGreaterThanOrEqual(0);
    expect(pos.a.y + h / 2).toBeLessThanOrEqual(BOARD.height);
  });

  it("keeps a grown card inside the board", () => {
    const pos = packCards([{ id: "a", scale: 3.4 }]);
    const { w, h } = visualSize(3.4);
    expect(pos.a.x - w / 2).toBeGreaterThanOrEqual(-1);
    expect(pos.a.x + w / 2).toBeLessThanOrEqual(BOARD.width + 1);
    expect(pos.a.y - h / 2).toBeGreaterThanOrEqual(-1);
    expect(pos.a.y + h / 2).toBeLessThanOrEqual(BOARD.height + 1);
  });

  it("does not overlap equal-sized cards in a row", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({ id: String(i), scale: 1 }));
    const pos = packCards(items);
    const { w, h } = visualSize(1);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const overlapX = Math.abs(pos[String(i)].x - pos[String(j)].x) < w - 1;
        const overlapY = Math.abs(pos[String(i)].y - pos[String(j)].y) < h - 1;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("wraps to a second row when the first fills up", () => {
    const n = Math.ceil(BOARD.width / CARD.width) + 2;
    const pos = packCards(Array.from({ length: n }, (_, i) => ({ id: String(i), scale: 1 })));
    const ys = new Set(Object.values(pos).map((p) => p.y));
    expect(ys.size).toBeGreaterThan(1);
  });
});

describe("sortTasks", () => {
  const now = T0 + 50 * 3_600_000;
  const tasks = [
    task({ id: "soon-low", impact: "low", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 60 * 3_600_000) }),
    task({ id: "late-critical", impact: "critical", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 400 * 3_600_000) }),
    task({ id: "mid-high", impact: "high", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 80 * 3_600_000) }),
  ];

  it.each([
    ["severity", ["late-critical", "mid-high", "soon-low"]],
    ["deadline", ["soon-low", "mid-high", "late-critical"]],
    ["fuse", ["soon-low", "mid-high", "late-critical"]],
  ] as const)("%s orders %j", (by: BoardSort, ids) => {
    expect(sortTasks(tasks, [], now, by).map((t) => t.id)).toEqual([...ids]);
  });
});

describe("readingOrder", () => {
  const tasks = [
    task({ id: "b", impact: "low", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 1), positionX: 800, positionY: 100 }),
    task({ id: "a", impact: "low", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 1), positionX: 200, positionY: 100 }),
    task({ id: "c", impact: "low", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 1), positionX: 200, positionY: 500 }),
  ];
  it("reads top-to-bottom, then left-to-right", () => {
    expect(readingOrder(tasks, {}).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a mixed-height row left-to-right (tall card center sits lower)", () => {
    const mixed = [
      task({ id: "tall", impact: "low", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 1), positionX: 200, positionY: 180 }),
      task({ id: "short", impact: "low", fuseStartedAt: iso(T0), deadlineAt: iso(T0 + 1), positionX: 600, positionY: 120 }),
    ];
    expect(readingOrder(mixed, {}).map((t) => t.id)).toEqual(["tall", "short"]);
  });
});
