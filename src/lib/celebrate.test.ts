import { describe, expect, it } from "vitest";
import { completeHeadline, completeToast } from "./celebrate";

describe("complete copy", () => {
  it("is stable for a given title", () => {
    expect(completeHeadline("Buy a gift")).toBe(completeHeadline("Buy a gift"));
    expect(completeHeadline("Buy a gift")).not.toBe(completeHeadline("Send the proposal"));
  });

  it("keeps a scar-aware line after explosions", () => {
    expect(completeToast("X", 2)).toEqual({ title: "You still finished it.", description: "X · the scar stays." });
  });
});
