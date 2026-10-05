import { BOARD } from "./board";

export type CardBox = { id: string; x: number; y: number; width: number; height: number };
const GAP = 24;
const intersects = (a: CardBox, b: CardBox) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + GAP && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + GAP;

/** Keep the dropped card anchored; displaced cards take their nearest free space. */
export function settleDrop(cards: CardBox[], id: string, x: number, y: number) {
  const dragged = cards.find((card) => card.id === id);
  if (!dragged) return null;
  const placed: CardBox[] = [];
  const result: Record<string, { x: number; y: number }> = {};
  for (const card of [dragged, ...cards.filter((item) => item.id !== id)]) {
    const minX = Math.max(110, card.width / 2 + 12);
    const maxX = Math.min(1890, BOARD.width - card.width / 2 - 12);
    const minY = Math.max(60, card.height / 2 + 12);
    const maxY = Math.min(1190, BOARD.height - card.height / 2 - 12);
    if (minX > maxX || minY > maxY) return null;
    const target = { x: Math.max(minX, Math.min(maxX, card.id === id ? x : card.x)), y: Math.max(minY, Math.min(maxY, card.id === id ? y : card.y)) };
    const xs = [target.x, minX, maxX];
    const ys = [target.y, minY, maxY];
    for (const obstacle of placed) {
      xs.push(Math.floor(obstacle.x - (obstacle.width + card.width) / 2 - GAP), Math.ceil(obstacle.x + (obstacle.width + card.width) / 2 + GAP));
      ys.push(Math.floor(obstacle.y - (obstacle.height + card.height) / 2 - GAP), Math.ceil(obstacle.y + (obstacle.height + card.height) / 2 + GAP));
    }
    const candidates = xs.flatMap((cx) => ys.map((cy) => ({ x: Math.round(cx), y: Math.round(cy) })))
      .filter((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
      .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    const free = candidates.find((p) => placed.every((other) => !intersects({ ...card, ...p }, other)));
    if (!free) return null;
    result[card.id] = free;
    placed.push({ ...card, ...free });
  }
  return result;
}
