import { describe, expect, it } from "vitest";
import { findTasks } from "./search";
import type { Task } from "./types";

describe("task title search", () => {
  const tasks = [{ id: "a", title: "Enviar proposta à Júlia" }, { id: "b", title: "Revisar contrato" }] as Task[];
  it("matches partial words irrespective of accents, case and word order", () => {
    expect(findTasks(tasks, "JULIA prop").map((t) => t.id)).toEqual(["a"]);
  });
  it("does not return unrelated titles or results for empty queries", () => {
    expect(findTasks(tasks, "proposta contrato")).toEqual([]);
    expect(findTasks(tasks, "   ")).toEqual([]);
  });
});
