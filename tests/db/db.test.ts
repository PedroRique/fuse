import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const H = 3_600_000;
let offset = 0;
const setClock = async (ms: number) => {
  offset = ms;
  const { error } = await admin.from("dev_clock").update({ offset_ms: ms }).eq("id", true);
  if (error) throw error;
};
const serverNow = () => Date.now() + offset;

async function newUser(): Promise<SupabaseClient> {
  const email = `db-${crypto.randomUUID()}@fuse.test`;
  const password = "password123";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

async function rpc(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as { ok: boolean; code?: string; taskId?: string; resolved?: boolean };
}

const createTask = async (c: SupabaseClient, hours = 2, title = "Send proposal") =>
  (
    await rpc(c, "create_task", {
      p_title: title,
      p_notes: null,
      p_impact: "high",
      p_deadline_at: new Date(serverNow() + hours * H).toISOString(),
      p_bother_after: null,
      p_fuse_preset: "2h",
      p_x: 300,
      p_y: 300,
    })
  ).taskId!;

beforeAll(() => setClock(0));
afterAll(() => setClock(0));

describe("row level security", () => {
  it("isolates users completely", async () => {
    const a = await newUser();
    const b = await newUser();
    const taskId = await createTask(a);

    expect((await a.from("tasks").select("id")).data).toHaveLength(1);
    expect((await b.from("tasks").select("id").eq("id", taskId)).data).toHaveLength(0);
    expect((await b.from("task_events").select("id").eq("task_id", taskId)).data).toHaveLength(0);
    expect((await b.from("boards").select("id")).data).toHaveLength(1);

    expect(await rpc(b, "complete_task", { p_task: taskId })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await rpc(b, "cut_wire", { p_task: taskId, p_reason: "other", p_explanation: "nope", p_new_end: new Date(serverNow() + 9 * H).toISOString() })).toMatchObject({ ok: false });
    expect(await rpc(b, "move_task", { p_task: taskId, p_x: 1, p_y: 1 })).toMatchObject({ ok: false });
    expect(await rpc(b, "restore_card", { p_task: taskId, p_x: 500, p_y: 500 })).toMatchObject({ ok: true, resolved: true });
    const { data } = await a.from("tasks").select("status, position_x").eq("id", taskId).single();
    expect(data).toMatchObject({ status: "active", position_x: 300 });
  });

  it("forbids direct writes to server-controlled data", async () => {
    const a = await newUser();
    const taskId = await createTask(a);
    const upd = await a.from("tasks").update({ explosion_count: 0, title: "x" }).eq("id", taskId).select();
    expect(upd.error).not.toBeNull();
    const ins = await a.from("task_events").insert({ type: "completed", task_id: taskId });
    expect(ins.error).not.toBeNull();
    const del = await a.from("task_events").delete().eq("task_id", taskId).select();
    expect(del.error).not.toBeNull();
    const internal = await a.rpc("_sync", { p_board: "00000000-0000-0000-0000-000000000000" });
    expect(internal.error).not.toBeNull();
  });

  it("rejects anonymous RPC calls", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    expect((await anon.rpc("sync_board")).error).not.toBeNull();
  });
});

describe("explosion, pause and rebuild", () => {
  it("explodes exactly once under concurrent syncs", async () => {
    await setClock(0);
    const a = await newUser();
    const taskId = await createTask(a);
    await setClock(2 * H + 60_000);
    await Promise.all([rpc(a, "sync_board"), rpc(a, "sync_board"), rpc(a, "sync_board")]);
    await rpc(a, "sync_board");

    const { data: task } = await a.from("tasks").select("status, explosion_count").eq("id", taskId).single();
    expect(task).toEqual({ status: "exploded", explosion_count: 1 });
    const { data: events } = await a.from("task_events").select("id").eq("task_id", taskId).eq("type", "exploded");
    expect(events).toHaveLength(1);
    const { data: incidents } = await a.from("board_incidents").select("phase, trigger_task_id");
    expect(incidents).toEqual([{ phase: "post_mortem", trigger_task_id: taskId }]);
    expect(await rpc(a, "complete_task", { p_task: taskId })).toMatchObject({ ok: false, code: "TASK_NOT_ACTIVE" });
    expect(await rpc(a, "create_task", { p_title: "x", p_notes: null, p_impact: "low", p_deadline_at: new Date(serverNow() + 5 * H).toISOString(), p_bother_after: null, p_fuse_preset: "custom", p_x: 0, p_y: 0 })).toMatchObject({ ok: false, code: "BOARD_DESTROYED" });
  });

  it("pauses freeze fuses and resume where they left off", async () => {
    await setClock(0);
    const a = await newUser();
    const taskId = await createTask(a);
    await setClock(H);
    await rpc(a, "start_pause", { p_hours: 2, p_reason: "Family emergency" });
    await setClock(2.5 * H); // raw deadline passed, but 1.5h of it was paused
    await rpc(a, "sync_board");
    expect((await a.from("tasks").select("status").eq("id", taskId).single()).data?.status).toBe("active");
    await setClock(3.9 * H); // pause ended at 3h; 0.9h burned since → 1.9h effective
    await rpc(a, "sync_board");
    expect((await a.from("tasks").select("status").eq("id", taskId).single()).data?.status).toBe("active");
    await setClock(4.05 * H);
    await rpc(a, "sync_board");
    expect((await a.from("tasks").select("status").eq("id", taskId).single()).data?.status).toBe("exploded");
    const { data: ended } = await a.from("task_events").select("metadata").eq("type", "emergency_pause_ended");
    expect(ended).toHaveLength(1);
  });

  it("requires a wire cut late in the fuse and never heals scars", async () => {
    await setClock(0);
    const a = await newUser();
    const taskId = await createTask(a, 10);
    await setClock(8 * H);
    const later = new Date(serverNow() + 24 * H).toISOString();
    expect(await rpc(a, "reschedule_task", { p_task: taskId, p_new_end: later })).toMatchObject({ code: "REQUIRES_WIRE_CUT" });
    await expect(rpc(a, "cut_wire", { p_task: taskId, p_reason: "waiting", p_explanation: "", p_new_end: later })).rejects.toThrow(/INVALID_INPUT/);
    expect(await rpc(a, "cut_wire", { p_task: taskId, p_reason: "waiting", p_explanation: "Client is late", p_new_end: later })).toMatchObject({ ok: true });
    const { data: ev } = await a.from("task_events").select("metadata").eq("type", "wire_cut").single();
    expect(ev?.metadata).toMatchObject({ reason: "waiting", explanation: "Client is late" });
    expect(Math.round((ev!.metadata as { addedMs: number }).addedMs / H)).toBe(22);
  });

  it("walks post-mortem → rebuild → restored, card by card", async () => {
    await setClock(0);
    const a = await newUser();
    const doomed = await createTask(a, 2, "Doomed");
    const other = await createTask(a, 48, "Other");
    await setClock(2 * H + 1000);
    await rpc(a, "sync_board");

    expect(await rpc(a, "restore_card", { p_task: other, p_x: 500, p_y: 500 })).toMatchObject({ ok: false, code: "BOARD_DESTROYED" });
    await expect(rpc(a, "submit_post_mortem", { p_task: doomed, p_reason: "procrastinated", p_explanation: "", p_resolution: "reschedule", p_new_end: null, p_discard_reason: null })).rejects.toThrow(/INVALID_INPUT/);
    expect(await rpc(a, "submit_post_mortem", { p_task: doomed, p_reason: "procrastinated", p_explanation: "Ignored it", p_resolution: "reschedule", p_new_end: new Date(serverNow() + 5 * H).toISOString(), p_discard_reason: null })).toMatchObject({ ok: true });

    const { data: incident } = await a.from("board_incidents").select("id, phase").single();
    expect(incident?.phase).toBe("rebuilding");
    const { data: cards } = await a.from("incident_tasks").select("task_id").eq("incident_id", incident!.id);
    expect(cards).toHaveLength(2);

    await expect(rpc(a, "restore_card", { p_task: other, p_x: -50, p_y: 500 })).rejects.toThrow(/outside/);
    expect(await rpc(a, "restore_card", { p_task: other, p_x: 500, p_y: 500 })).toMatchObject({ ok: true, resolved: false });
    expect(await rpc(a, "restore_card", { p_task: doomed, p_x: 900, p_y: 400 })).toMatchObject({ ok: true, resolved: true });
    expect((await a.from("board_incidents").select("phase").single()).data?.phase).toBe("resolved");

    const { data: t } = await a.from("tasks").select("status, explosion_count, position_x").eq("id", doomed).single();
    expect(t).toEqual({ status: "active", explosion_count: 1, position_x: 900 });

    // Second explosion of the same task: count keeps climbing.
    await setClock(serverNow() - Date.now() + 5 * H + 1000);
    await rpc(a, "sync_board");
    expect((await a.from("tasks").select("explosion_count").eq("id", doomed).single()).data?.explosion_count).toBe(2);
  });
});
