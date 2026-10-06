import type { BoardPause, Impact, Task } from "./types";
import { BOARD, CARD } from "./board";
import { getTaskTemporalState } from "./urgency";

export const IMPACT_RANK: Record<Impact, number> = { low: 1, normal: 2, high: 3, critical: 4 };

export type BoardSort = "severity" | "deadline" | "fuse";

const PAD = 40;
const GAP = 32;
/** Cards wrap a bit taller than CARD.height once title + fuse + badge stack. */
const HEIGHT_FUDGE = 1.15;

export function visualSize(scale: number) {
  const s = Math.max(0.35, scale);
  return { w: CARD.width * s, h: CARD.height * HEIGHT_FUDGE * s };
}

/** Left-to-right, wrap to the next row. Centers are what the canvas stores. */
export function packCards(items: readonly { id: string; scale: number }[]) {
  const out: Record<string, { x: number; y: number }> = {};
  let x = PAD;
  let y = PAD;
  let rowH = 0;

  for (const item of items) {
    const { w, h } = visualSize(item.scale);
    if (x > PAD && x + w > BOARD.width - PAD) {
      x = PAD;
      y += rowH + GAP;
      rowH = 0;
    }
    const left = w >= BOARD.width - 2 * PAD ? (BOARD.width - w) / 2 : x;
    out[item.id] = { x: left + w / 2, y: y + h / 2 };
    x = left + w + GAP;
    rowH = Math.max(rowH, h);
  }

  // ponytail: if a packed row runs past the board floor, cards clamp and may overlap.
  // Upgrade: scale the whole grid down, or add another page of canvas.
  for (const item of items) {
    const { w, h } = visualSize(item.scale);
    const hw = Math.min(w / 2, BOARD.width / 2);
    const hh = Math.min(h / 2, BOARD.height / 2);
    const p = out[item.id];
    p.x = Math.round(Math.min(BOARD.width - hw, Math.max(hw, p.x)));
    p.y = Math.round(Math.min(BOARD.height - hh, Math.max(hh, p.y)));
  }
  return out;
}

export function sortTasks(
  tasks: readonly Task[],
  pauses: readonly BoardPause[],
  now: number,
  by: BoardSort,
): Task[] {
  const temporal = new Map(tasks.map((task) => [task.id, getTaskTemporalState(task, pauses, now)]));
  const byDeadline = (a: Task, b: Task) => temporal.get(a.id)!.remainingMs - temporal.get(b.id)!.remainingMs;
  const byFuse = (a: Task, b: Task) => {
    const ta = temporal.get(a.id)!;
    const tb = temporal.get(b.id)!;
    // Quiet cards must not outrank a visibly critical fuse.
    return Number(ta.isDormant) - Number(tb.isDormant) || tb.progress - ta.progress || byDeadline(a, b);
  };
  return [...tasks].sort((a, b) => {
    const done = Number(a.status === "completed") - Number(b.status === "completed");
    if (done) return done;
    if (by === "severity") {
      const d = IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact];
      if (d) return d;
      return byFuse(a, b) || a.id.localeCompare(b.id);
    }
    if (by === "deadline") {
      const d = byDeadline(a, b);
      if (d) return d;
      return a.id.localeCompare(b.id);
    }
    return byFuse(a, b) || a.id.localeCompare(b.id);
  });
}

/** Current visual reading order: top-to-bottom in coarse rows, then left-to-right.
 * Row banding uses center y so a tall card in the same row isn't treated as "below" shorter ones.
 */
export function readingOrder(tasks: readonly Task[], positions: Record<string, { x: number; y: number }>) {
  const rowOf = (y: number) => Math.round(y / 200);
  return [...tasks].sort((a, b) => {
    const pa = positions[a.id] ?? { x: a.positionX, y: a.positionY };
    const pb = positions[b.id] ?? { x: b.positionX, y: b.positionY };
    return rowOf(pa.y) - rowOf(pb.y) || pa.x - pb.x || a.id.localeCompare(b.id);
  });
}
