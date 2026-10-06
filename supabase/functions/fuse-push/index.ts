import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function allowedEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return url.protocol === "https:" && !url.port && !url.username && !url.password &&
    (url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com"));
}
async function send(device: { endpoint: string; p256dh: string; auth: string }, payload: unknown, ttl: number) {
  if (!allowedEndpoint(device.endpoint)) throw new Error("Unsupported push service");
  const request = webpush.generateRequestDetails({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, JSON.stringify(payload), { TTL: ttl, urgency: "high" });
  return await fetch(request.endpoint, { method: "POST", headers: request.headers, body: new Uint8Array(request.body), redirect: "error", signal: AbortSignal.timeout(10000) });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return json({ error: "Request too large" }, 413);
  // Reject requests with no credentials before any database/configuration lookup.
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  const cronToken = req.headers.get("x-fuse-cron");
  if (!token && !cronToken) return json({ error: "Unauthorized" }, 401);
  try {
    const reader = req.body?.getReader();
    if (!reader) return json({ error: "Invalid request" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return json({ error: "Request too large" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: "Invalid request" }, 400); }
    if (!body || typeof body !== "object" || !["test", "dispatch"].includes(body.mode)) return json({ error: "Invalid request" }, 400);
    let userId: string | undefined;
    if (body.mode === "test") {
      if (!token) return json({ error: "Sign in again" }, 401);
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "Sign in again" }, 401);
      userId = user.id;
      if (typeof body.subscriptionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.subscriptionId)) return json({ error: "Invalid device" }, 400);
      const { data: allowed, error: rateError } = await admin.rpc("claim_push_test", { p_user: user.id });
      if (rateError) throw rateError;
      if (!allowed) return json({ error: "Too many notification tests. Try again later." }, 429);
    } else {
      if (!cronToken || cronToken.length > 256) return json({ error: "Unauthorized" }, 401);
      const { data: authorized, error: authError } = await admin.rpc("authorize_push_cron", { p_token: cronToken });
      if (authError || !authorized) return json({ error: "Unauthorized" }, 401);
    }
    const { data: config, error } = await admin.rpc("push_configuration");
    if (error || !config?.fuse_push_private) return json({ error: "Push is not configured" }, 503);
    webpush.setVapidDetails("https://fuse-blond.vercel.app", config.fuse_push_public, config.fuse_push_private);
    if (body.mode === "test") {
      const { data: device } = await admin.from("push_subscriptions").select("*").eq("id", body.subscriptionId).eq("user_id", userId).single();
      if (!device) return json({ error: "Device not found" }, 404);
      // Atomic per-device rate limit. Users cannot modify last_test_at through RLS.
      const { data: claimed, error: claimError } = await admin.from("push_subscriptions")
        .update({ last_test_at: new Date().toISOString() }).eq("id", device.id)
        .or(`last_test_at.is.null,last_test_at.lt.${new Date(Date.now()-60000).toISOString()}`).select("id");
      if (claimError) throw claimError;
      if (!claimed?.length) return json({ error: "Wait a minute before testing again" }, 429);
      const result = await send(device, { title: "Fuse notifications are on", body: "This device will receive urgent and critical task alerts.", url: "/board", tag: "fuse-test" }, 60);
      if (result.status === 404 || result.status === 410) await admin.from("push_subscriptions").delete().eq("id",device.id);
      return result.ok ? json({ ok: true }) : json({ error: "Push service rejected the notification. Disable and enable notifications again." }, 502);
    }
    // JWT verification is disabled at the gateway: cron uses this private Vault token.
    const { data: deliveries, error: queueError } = await admin.rpc("claim_push_deliveries");
    if (queueError) throw queueError;
    let sent = 0;
    // Small batches bound outbound concurrency and runtime; failed deliveries retry later.
    for (let offset = 0; offset < deliveries.length; offset += 10) {
      await Promise.all(deliveries.slice(offset, offset+10).map(async (delivery) => {
        try {
          const { data: stage } = await admin.rpc("push_task_stage", { p_task: delivery.taskId });
          if (stage !== delivery.stage) return;
          const minutes = Math.max(1, Math.ceil(delivery.remainingMs / 60000));
          const result = await send(delivery, {
            title: delivery.stage === "critical" ? "Critical fuse" : "Task getting urgent",
            body: `${delivery.title} — ${minutes} min remaining`,
            url: `/board?task=${delivery.taskId}`, tag: `fuse-${delivery.taskId}`,
          }, Math.max(1,Math.min(300,Math.floor(delivery.remainingMs/1000))));
          if (result.ok) {
            const { error: markError } = await admin.from("push_deliveries").update({ sent_at: new Date().toISOString() }).eq("id",delivery.id);
            if (markError) throw markError;
            sent++;
          } else if (result.status === 404 || result.status === 410) {
            await admin.from("push_subscriptions").delete().eq("id",delivery.subscriptionId);
          } else console.error("Push provider rejected delivery", result.status);
        } catch { console.error("Push delivery failed; will retry"); }
      }));
    }
    return json({ ok: true, queued: deliveries.length, sent });
  } catch { return json({ error: "Push request failed" }, 500); }
});
