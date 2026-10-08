import { createClient } from "@/lib/supabase/server";
import { detectAudioType, MAX_AUDIO_BYTES } from "@/domain/audio-import";
import { MAX_IMPORT_TEXT } from "@/domain/task-import";

export const maxDuration = 60;
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply("Invalid request origin.", 403);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply("Sign in again.", 401);
  const credential = process.env.AI_GATEWAY_API_KEY
    || (process.env.VERCEL === "1" ? request.headers.get("x-vercel-oidc-token") : null)
    || process.env.VERCEL_OIDC_TOKEN;
  if (!credential) return reply("Audio import isn't configured yet. Your audio has been kept.", 503);
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_AUDIO_BYTES) return reply("Choose audio smaller than 3 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) return reply("Choose or record some audio first.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_AUDIO_BYTES) { await reader.cancel(); return reply("Choose audio smaller than 3 MB.", 413); }
      chunks.push(value);
    }
  } catch { return reply("Couldn't receive the audio. Try again.", 400); }
  const audio = Buffer.concat(chunks);
  const mediaType = detectAudioType(audio);
  if (!mediaType) return reply("Use MP3, M4A, WAV, WebM, Ogg or FLAC audio.", 415);
  // Transcription and task extraction share the durable account quota.
  const { data: allowed, error: quotaError } = await supabase.rpc("claim_task_extraction");
  if (quotaError) return reply("Couldn't check your import limit. Try again.", 503);
  if (!allowed) return reply("AI limit reached. Try later (3 requests/minute, 20/day).", 429);
  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v4/ai/transcription-model", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(45000),
      headers: {
        Authorization: `Bearer ${credential}`, "Content-Type": "application/json",
        "ai-gateway-protocol-version": "0.0.1", "ai-transcription-model-specification-version": "4",
        "ai-model-id": process.env.AI_GATEWAY_TRANSCRIPTION_MODEL || "openai/whisper-1",
      },
      body: JSON.stringify({ audio: audio.toString("base64"), mediaType }),
    });
    if (!response.ok) {
      if ([401, 402, 403, 404].includes(response.status)) return reply("Transcription needs Gateway access or credits. You can still paste text instead.", 503);
      if (response.status === 429) return reply("Transcription is busy. Wait a moment and retry.", 429);
      return reply("Couldn't transcribe this audio. Try a shorter recording or another format.", 502);
    }
    const result = await response.json();
    if (typeof result.text !== "string" || !result.text.trim()) return reply("No speech found. Try a clearer recording.", 422);
    const text = result.text.trim();
    if (text.length > MAX_IMPORT_TEXT) return reply("The transcript is too long. Use a shorter audio (up to 16,000 characters of speech).", 422);
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch { return reply("Couldn't finish transcription. Your audio has been kept; try again.", 502); }
}
