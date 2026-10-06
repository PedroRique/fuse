import { describe, expect, it } from "vitest";
import { resolveFusePreset } from "./presets";

describe("quick deadlines in local time", () => {
  it("Tomorrow ends the next calendar day across the month boundary", () => {
    const result = resolveFusePreset("tomorrow", new Date(2026, 9, 31, 22));
    expect([result.getFullYear(), result.getMonth(), result.getDate(), result.getHours(), result.getMinutes()]).toEqual([2026, 10, 1, 23, 59]);
  });
  it("This week ends on Sunday, including when created on Sunday", () => {
    for (const day of [6, 11]) {
      const result = resolveFusePreset("this_week", new Date(2026, 9, day, 12));
      expect([result.getDate(), result.getDay(), result.getHours()]).toEqual([11, 0, 23]);
    }
  });
});
