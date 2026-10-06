"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const subscriptionSchema = z.object({ endpoint: z.url().max(2048), keys: z.object({
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=$|^[A-Za-z0-9_-]{87}$/),
  auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
}) });
function allowedEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return url.protocol === "https:" && !url.port && !url.username && !url.password &&
    (url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com"));
}
export async function savePushSubscription(input: unknown) {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success || !allowedEndpoint(parsed.data.endpoint)) return { error: "Unsupported notification subscription." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again." };
  const { data: existing } = await supabase.from("push_subscriptions").select("id").eq("endpoint",parsed.data.endpoint).maybeSingle();
  if (existing) {
    const { error } = await supabase.from("push_subscriptions").update(parsed.data.keys).eq("id", existing.id);
    return error ? { error: "Couldn't refresh notifications." } : { id: existing.id as string };
  }
  const { data, error } = await supabase.from("push_subscriptions").insert({ user_id: user.id, endpoint: parsed.data.endpoint, ...parsed.data.keys }).select("id").single();
  return error ? { error: "Couldn't save this device. Disable notifications and try again." } : { id: data.id as string };
}
export async function removePushSubscription(endpoint: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again." };
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint",endpoint);
  return error ? { error: "Couldn't disable notifications." } : { ok: true };
}
export async function testPushNotification(subscriptionId: string) {
  if (!z.uuid().safeParse(subscriptionId).success) return { error: "Invalid device." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again." };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Sign in again." };
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fuse-push`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ mode: "test", subscriptionId }), signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    return response.ok ? { ok: true } : { error: result.error ?? "Couldn't send notification." };
  } catch { return { error: "Couldn't reach the notification service." }; }
}
