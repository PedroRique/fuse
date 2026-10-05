import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BoardIncident, BoardPause, Task, TaskEvent } from "@/domain/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- row shapes come from PostgREST */
export const mapTask = (r: any): Task => ({
  id: r.id,
  userId: r.user_id,
  boardId: r.board_id,
  title: r.title,
  notes: r.notes,
  createdAt: r.created_at,
  fuseStartedAt: r.fuse_started_at,
  deadlineAt: r.deadline_at,
  botherAfter: r.bother_after,
  impact: r.impact,
  status: r.status,
  explosionCount: r.explosion_count,
  completedAt: r.completed_at,
  discardedAt: r.discarded_at,
  positionX: r.position_x,
  positionY: r.position_y,
  updatedAt: r.updated_at,
});

const mapPause = (r: any): BoardPause => ({
  id: r.id,
  reason: r.reason,
  startedAt: r.started_at,
  plannedEndAt: r.planned_end_at,
  endedAt: r.ended_at,
});

export type BoardSnapshot = {
  serverNow: string;
  tasks: Task[];
  pauses: BoardPause[];
  incident: BoardIncident | null;
  /** Events for tasks currently on the board, newest first (details dialog history). */
  events: TaskEvent[];
};

/** Runs the server-side sync (explosions, pause closing) and returns everything the board renders. */
export async function loadBoard(): Promise<BoardSnapshot> {
  const supabase = await createClient();
  const { data: sync, error } = await supabase.rpc("sync_board");
  if (error) throw error;

  const [tasks, pauses, incident] = await Promise.all([
    supabase.from("tasks").select("*").in("status", ["active", "exploded"]).order("created_at"),
    // ponytail: all pauses of the board; fine for years of usage, filter by date if it ever grows large.
    supabase.from("board_pauses").select("*").order("started_at"),
    supabase
      .from("board_incidents")
      .select("*, incident_tasks(*)")
      .neq("phase", "resolved")
      .maybeSingle(),
  ]);
  for (const r of [tasks, pauses, incident]) if (r.error) throw r.error;

  const taskIds = (tasks.data ?? []).map((t) => t.id);
  const events = taskIds.length
    ? await supabase.from("task_events").select("*").in("task_id", taskIds).order("occurred_at", { ascending: false }).limit(500)
    : { data: [] as any[] };

  const i = incident.data;
  return {
    serverNow: (sync as { serverNow: string }).serverNow,
    tasks: (tasks.data ?? []).map(mapTask),
    pauses: (pauses.data ?? []).map(mapPause),
    incident: i
      ? {
          id: i.id,
          triggerTaskId: i.trigger_task_id,
          phase: i.phase,
          explodedAt: i.exploded_at,
          tasks: (i.incident_tasks ?? []).map((it: any) => ({
            taskId: it.task_id,
            exploded: it.exploded,
            postMortemDone: !!it.post_mortem_at,
            restoredAt: it.restored_at,
          })),
        }
      : null,
    events: (events.data ?? []).map(mapEvent),
  };
}

const mapEvent = (r: any): TaskEvent => ({
  id: r.id,
  type: r.type,
  taskId: r.task_id,
  occurredAt: r.occurred_at,
  metadata: r.metadata ?? {},
});

export type HistoryEntry = TaskEvent & { task: Pick<Task, "title" | "explosionCount" | "status"> | null };

export async function loadHistory(types: string[] | null): Promise<HistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_events")
    .select("*, tasks(title, explosion_count, status)")
    .in("type", types ?? ["completed", "exploded", "wire_cut", "discarded", "rescheduled", "emergency_pause_started", "emergency_pause_ended", "board_restored"])
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...mapEvent(r),
    task: r.tasks ? { title: r.tasks.title, explosionCount: r.tasks.explosion_count, status: r.tasks.status } : null,
  }));
}

export async function getProfile() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return null;
  const { data } = await supabase.from("profiles").select("onboarded_at").eq("id", claims.claims.sub).maybeSingle();
  return { userId: claims.claims.sub as string, email: (claims.claims.email as string) ?? "", onboarded: !!data?.onboarded_at };
}
