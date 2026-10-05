"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  createTaskSchema,
  cutWireSchema,
  moveSchema,
  pauseSchema,
  postMortemSchema,
  rescheduleSchema,
  restoreSchema,
  taskIdSchema,
  updateContentSchema,
} from "./schemas";

export type ActionResult = { ok: true; data?: Record<string, unknown> } | { ok: false; error: string; code?: string };

const MESSAGES: Record<string, string> = {
  BOARD_DESTROYED: "Your board exploded. Deal with it before doing anything else.",
  TASK_NOT_ACTIVE: "This task is no longer active. Its fuse may have just run out.",
  NOT_FOUND: "That task doesn't exist anymore.",
  REQUIRES_WIRE_CUT: "This fuse is too far gone to edit. Cut the wire instead.",
  NOT_AN_EXTENSION: "Cutting the wire has to give you more time.",
  NO_INCIDENT: "There is nothing to post-mortem.",
  NOT_AUTHENTICATED: "Your session expired. Sign in again.",
};

async function call<S extends z.ZodType>(schema: S, input: unknown, fn: string, toArgs: (v: z.infer<S>) => Record<string, unknown>): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, toArgs(parsed.data));
  if (error) {
    const code = Object.keys(MESSAGES).find((k) => error.message.includes(k));
    return { ok: false, code, error: code ? MESSAGES[code] : error.message.replace(/^INVALID_INPUT: /, "Invalid input: ") };
  }
  const res = data as { ok: boolean; code?: string } & Record<string, unknown>;
  if (!res.ok) return { ok: false, code: res.code, error: MESSAGES[res.code ?? ""] ?? "Something went wrong." };
  return { ok: true, data: res };
}

export const syncBoard = async () => call(z.object({}), {}, "sync_board", () => ({}));

export const createTask = async (input: z.input<typeof createTaskSchema>) =>
  call(createTaskSchema, input, "create_task", (v) => ({
    p_title: v.title,
    p_notes: v.notes ?? null,
    p_impact: v.impact,
    p_deadline_at: v.deadlineAt,
    p_bother_after: v.botherAfter,
    p_fuse_preset: v.fusePreset,
    p_x: v.x,
    p_y: v.y,
  }));

export const updateTaskContent = async (input: z.input<typeof updateContentSchema>) =>
  call(updateContentSchema, input, "update_task_content", (v) => ({
    p_task: v.taskId,
    p_title: v.title,
    p_notes: v.notes ?? null,
    p_impact: v.impact,
  }));

export const moveTask = async (input: z.input<typeof moveSchema>) =>
  call(moveSchema, input, "move_task", (v) => ({ p_task: v.taskId, p_x: v.x, p_y: v.y }));

export const completeTask = async (input: z.input<typeof taskIdSchema>) =>
  call(taskIdSchema, input, "complete_task", (v) => ({ p_task: v.taskId }));

export const rescheduleTask = async (input: z.input<typeof rescheduleSchema>) =>
  call(rescheduleSchema, input, "reschedule_task", (v) => ({ p_task: v.taskId, p_new_end: v.newEnd }));

export const cutWire = async (input: z.input<typeof cutWireSchema>) =>
  call(cutWireSchema, input, "cut_wire", (v) => ({
    p_task: v.taskId,
    p_reason: v.reason,
    p_explanation: v.explanation,
    p_new_end: v.newEnd,
  }));

export const startPause = async (input: z.input<typeof pauseSchema>) =>
  call(pauseSchema, input, "start_pause", (v) => ({ p_hours: v.hours, p_reason: v.reason }));

export const endPause = async () => call(z.object({}), {}, "end_pause", () => ({}));

export const submitPostMortem = async (input: z.input<typeof postMortemSchema>) =>
  call(postMortemSchema, input, "submit_post_mortem", (v) => ({
    p_task: v.taskId,
    p_reason: v.reason,
    p_explanation: v.explanation,
    p_resolution: v.resolution,
    p_new_end: v.resolution === "reschedule" ? v.newEnd : null,
    p_discard_reason: v.resolution === "discard" ? v.discardReason : null,
  }));

export const restoreCard = async (input: z.input<typeof restoreSchema>) =>
  call(restoreSchema, input, "restore_card", (v) => ({ p_task: v.taskId, p_x: v.x, p_y: v.y }));

export async function completeOnboarding() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding");
  if (error) return { ok: false as const, error: error.message };
  redirect("/board");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
