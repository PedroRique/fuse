import type { BoardPause, Task } from "./types";
import { getEffectiveDeadline } from "./time";
import { getTaskTemporalState } from "./urgency";

export const LIST_FILTERS = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "urgent", label: "Urgent" },
  { value: "completed", label: "Completed" },
] as const;
export type ListFilter = (typeof LIST_FILTERS)[number]["value"];

export function filterListTasks(tasks: readonly Task[], pauses: readonly BoardPause[], now: number, filter: ListFilter, hideCompleted = false): Task[] {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return tasks.filter((task) => {
    if (filter === "completed") return task.status === "completed";
    if (filter === "all") return task.status === "active" || (!hideCompleted && task.status === "completed");
    if (task.status !== "active") return false;
    if (filter === "today") {
      const deadline = getEffectiveDeadline(task, pauses, now);
      return deadline >= dayStart.getTime() && deadline < dayEnd.getTime();
    }
    const temporal = getTaskTemporalState(task, pauses, now);
    return !temporal.isDormant && ["warning", "critical", "exploded"].includes(temporal.state);
  });
}
