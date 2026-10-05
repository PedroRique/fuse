import { describe, expect, it } from "vitest";
import { settleDrop } from "./drop-layout";

describe("drop layout", () => {
  it("keeps the dropped card anchored and separates chained collisions", () => {
    const cards = ["a", "b", "c"].map((id) => ({ id, x: 500, y: 400, width: 220, height: 160 }));
    const result = settleDrop(cards, "a", 500, 400)!;
    expect(result.a).toEqual({ x: 500, y: 400 });
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = result[cards[i].id], b = result[cards[j].id];
      expect(Math.abs(a.x - b.x) >= 244 || Math.abs(a.y - b.y) >= 184).toBe(true);
    }
  });
  it("preserves distant cards and rejects cards that cannot fit", () => {
    expect(settleDrop([{ id: "a", x: 300, y: 200, width: 220, height: 160 }, { id: "b", x: 1500, y: 900, width: 220, height: 160 }], "a", 400, 300)?.b).toEqual({ x: 1500, y: 900 });
    expect(settleDrop([{ id: "a", x: 500, y: 400, width: 3000, height: 160 }], "a", 500, 400)).toBeNull();
  });
});
