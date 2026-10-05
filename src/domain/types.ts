export const IMPACTS = ["low", "normal", "high", "critical"] as const;
export type Impact = (typeof IMPACTS)[number];

export type TaskStatus = "active" | "completed" | "discarded" | "exploded";

/** ISO-8601 timestamps everywhere; the domain never reads the wall clock itself. */
export type Task = {
  id: string;
  userId: string;
  boardId: string;
  title: string;
  notes: string | null;
  createdAt: string;
  fuseStartedAt: string;
  deadlineAt: string;
  botherAfter: string | null;
  impact: Impact;
  status: TaskStatus;
  explosionCount: number;
  completedAt: string | null;
  discardedAt: string | null;
  positionX: number;
  positionY: number;
  updatedAt: string;
};

export type BoardPause = {
  id: string;
  reason: string;
  startedAt: string;
  plannedEndAt: string;
  endedAt: string | null;
};

export const TASK_EVENT_TYPES = [
  "created",
  "completed",
  "wire_cut",
  "exploded",
  "rescheduled",
  "discarded",
  "emergency_pause_started",
  "emergency_pause_ended",
  "post_mortem",
  "board_restored",
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export type TaskEvent = {
  id: string;
  type: TaskEventType;
  taskId: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export const WHAT_HAPPENED = [
  { value: "unexpected", label: "Something unexpected happened" },
  { value: "waiting", label: "I'm waiting for someone" },
  { value: "underestimated", label: "I underestimated the task" },
  { value: "procrastinated", label: "I procrastinated" },
  { value: "no_longer_relevant", label: "The task is no longer relevant" },
  { value: "other", label: "Other" },
] as const;
export type WhatHappened = (typeof WHAT_HAPPENED)[number]["value"];

export type IncidentPhase = "post_mortem" | "rebuilding" | "resolved";

export type BoardIncident = {
  id: string;
  triggerTaskId: string;
  phase: IncidentPhase;
  explodedAt: string;
  tasks: IncidentTask[];
};

export type IncidentTask = {
  taskId: string;
  exploded: boolean;
  postMortemDone: boolean;
  restoredAt: string | null;
};
