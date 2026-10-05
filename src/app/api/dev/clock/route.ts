import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Development-only time travel. The dev_clock table only exists in local databases (supabase/seed.sql).
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development" || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new NextResponse("Not found", { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { advanceMs?: number; setMs?: number; reset?: boolean };
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.from("dev_clock").select("offset_ms").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const current = Number(data.offset_ms);
  const next = body.reset ? 0 : typeof body.setMs === "number" ? body.setMs : current + Math.max(0, Number(body.advanceMs ?? 0));
  const { error: updateError } = await admin.from("dev_clock").update({ offset_ms: Math.round(next) }).eq("id", true);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ offsetMs: next });
}
