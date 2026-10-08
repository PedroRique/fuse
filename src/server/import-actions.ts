"use server";

import { createClient } from "@/lib/supabase/server";
import { importTasksSchema } from "@/domain/task-import";

export async function importTasks(input: unknown) {
  const parsed = importTasksSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the titles, priorities and deadlines before importing." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again." };
  const { data, error } = await supabase.rpc("import_tasks", { p_request: parsed.data.requestId, p_tasks: parsed.data.tasks });
  if (error) {
    if (error.message.includes("RATE_LIMITED")) return { error: "Too many tasks created recently. Wait a minute and retry this batch.", safeToEdit:true };
    if (error.message.includes("TASK_LIMIT")) return { error: "Your board reached its task limit.", safeToEdit:true };
    if (error.message.includes("IMPORT_CHANGED")) return { error: "This batch was already imported. Close this dialog and start a new import." };
    return { error: "Couldn't import the batch. Check that every deadline is in the future and retry.", safeToEdit: ["P0001","22P02","22007","22008","23514"].includes(error.code) };
  }
  if (!data?.ok) return { error: "Resolve the board incident before importing tasks.", safeToEdit:true };
  return { taskIds: data.taskIds as string[], replayed: data.replayed as boolean | undefined };
}
