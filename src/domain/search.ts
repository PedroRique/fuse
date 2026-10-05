import type { Task } from "./types";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function findTasks(tasks: readonly Task[], query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return tasks.filter((task) => terms.every((term) => normalize(task.title).includes(term)));
}
