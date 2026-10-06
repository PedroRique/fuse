import { describe, expect, it } from "vitest";
import { filterListTasks } from "./list-filters";
import type { BoardPause, Task } from "./types";

const now = new Date(2026, 9, 6, 12).getTime();
const iso = (value: number) => new Date(value).toISOString();
function task(id: string, changes: Partial<Task> = {}): Task {
  return { id, userId: "u", boardId: "b", title: id, notes: null, createdAt: iso(now),
    updatedAt: iso(now), fuseStartedAt: iso(now - 80 * 60000), deadlineAt: iso(now + 20 * 60000),
    botherAfter: null, impact: "normal", status: "active", explosionCount: 0,
    completedAt: null, discardedAt: null, positionX: 0, positionY: 0, ...changes };
}
const ids = (tasks: Task[]) => tasks.map((t) => t.id);
describe("list filters", () => {
  it("shows completed explicitly even when hidden in All", () => {
    const tasks = [task("active"), task("done", { status: "completed" }), task("discarded", { status: "discarded" })];
    expect(ids(filterListTasks(tasks, [], now, "all", true))).toEqual(["active"]);
    expect(ids(filterListTasks(tasks, [], now, "completed", true))).toEqual(["done"]);
  });
  it("uses local calendar boundaries and the deadline shifted by pauses", () => {
    const tasks = [task("today"), task("tomorrow", { deadlineAt: iso(new Date(2026, 9, 7).getTime()) }),
      task("shifted", { fuseStartedAt: iso(now - 86400000), deadlineAt: iso(new Date(2026, 9, 6, 23, 30).getTime()) })];
    const pauses: BoardPause[] = [{ id: "p", reason: "break", startedAt: iso(now - 4 * 3600000), plannedEndAt: iso(now - 2 * 3600000), endedAt: null }];
    expect(ids(filterListTasks(tasks, pauses, now, "today"))).toEqual(["today"]);
  });
  it("includes warning and critical tasks, but excludes dormant and completed tasks", () => {
    const tasks = [task("warning"), task("critical", { fuseStartedAt: iso(now - 95 * 60000), deadlineAt: iso(now + 5 * 60000) }),
      task("dormant", { botherAfter: iso(now + 60000) }), task("done", { status: "completed" }),
      task("safe", { fuseStartedAt: iso(now), deadlineAt: iso(now + 86400000) })];
    expect(ids(filterListTasks(tasks, [], now, "urgent"))).toEqual(["warning", "critical"]);
  });
});
