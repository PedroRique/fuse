import type { BoardPause, Impact, Task } from "./types";
import { BOARD, CARD } from "./board";
import { getProgress } from "./time";

export const IMPACT_RANK: Record<Impact, number> = { low: 1, normal: 2, high: 3, critical: 4 };

export type BoardSort = "severity" | "deadline" | "fuse";

const PAD = 40;
const GAP = 32;
/** Cards wrap a bit taller than CARD.height once title + fuse + badge stack. */
const HEIGHT_FUDGE = 1.15;

export function visualSize(scale: number) {
  const s = Math.max(1, scale);
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
  return [...tasks].sort((a, b) => {
    if (by === "severity") {
      const d = IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact];
      if (d) return d;
      return getProgress(b, pauses, now) - getProgress(a, pauses, now);
    }
    if (by === "deadline") {
      const d = Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt);
      if (d) return d;
      return a.id.localeCompare(b.id);
    }
    const d = getProgress(b, pauses, now) - getProgress(a, pauses, now);
    if (d) return d;
    return Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt);
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
