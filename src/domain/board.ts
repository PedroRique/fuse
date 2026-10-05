import type { BoardIncident, BoardPause } from "./types";
import { getActivePause } from "./time";

/** World coordinates. Mirrored in SQL (restore_card / move_task). */
export const BOARD = { width: 2000, height: 1250 } as const;
export const CARD = { width: 220, height: 120 } as const;
/** Staging ring around the board during a rebuild. */
export const STAGING_MARGIN = 320;

export type BoardState = "active" | "paused" | "destroyed" | "rebuilding";

/** Incident beats pause: a destroyed board can't be paused away. */
export function getBoardState(
  incident: Pick<BoardIncident, "phase"> | null,
  pauses: readonly BoardPause[],
  now: number,
): BoardState {
  if (incident?.phase === "post_mortem") return "destroyed";
  if (incident?.phase === "rebuilding") return "rebuilding";
  return getActivePause(pauses, now) ? "paused" : "active";
}

const half = { x: CARD.width / 2, y: CARD.height / 2 };

export function clampToBoard(x: number, y: number) {
  return {
    x: Math.round(Math.min(BOARD.width - half.x, Math.max(half.x, x))),
    y: Math.round(Math.min(BOARD.height - half.y, Math.max(half.y, y))),
  };
}

/** Card centers anywhere on the board count; no pixel-perfect placement required. */
export const isInsideBoard = (x: number, y: number) =>
  x >= 0 && x <= BOARD.width && y >= 0 && y <= BOARD.height;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/**
 * Deterministic scattered positions in the staging ring, in board coordinates
 * (so values are negative or beyond the board size). Same input → same layout across refreshes.
 */
export function getStagingPositions(taskIds: readonly string[]) {
  const n = Math.max(taskIds.length, 1);
  const m = STAGING_MARGIN / 2;
  const w = BOARD.width + 2 * m;
  const h = BOARD.height + 2 * m;
  const perimeter = 2 * (w + h);
  return Object.fromEntries(
    taskIds.map((id, i) => {
      // ponytail: cards share the ring evenly; with hundreds of cards they overlap in staging.
      let t = (((i + 0.5 + (hash(id) - 0.5) * 0.6) / n) * perimeter) % perimeter;
      let p: { x: number; y: number };
      if (t < w) p = { x: t, y: 0 };
      else if ((t -= w) < h) p = { x: w, y: t };
      else if ((t -= h) < w) p = { x: w - t, y: h };
      else p = { x: 0, y: h - (t - w) };
      return [id, { x: Math.round(p.x - m), y: Math.round(p.y - m) }];
    }),
  ) as Record<string, { x: number; y: number }>;
}

/** Keyboard placement: next grid slot not already near a placed card. */
export function getNextFreeSlot(occupied: readonly { x: number; y: number }[]) {
  const stepX = CARD.width + 40;
  const stepY = CARD.height + 40;
  for (let y = 120; y < BOARD.height - half.y; y += stepY) {
    for (let x = 160; x < BOARD.width - half.x; x += stepX) {
      if (!occupied.some((o) => Math.abs(o.x - x) < stepX / 2 && Math.abs(o.y - y) < stepY / 2)) {
        return { x, y };
      }
    }
  }
  return { x: BOARD.width / 2, y: BOARD.height / 2 };
}

/** Initial position for a new task: a free slot near the top-left of the board. */
export const getNewTaskPosition = getNextFreeSlot;
