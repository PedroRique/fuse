import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MAX_AUDIO_BYTES } from "@/domain/audio-import";
const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
import { POST } from "./route";

const wav = () => Buffer.from("RIFF0000WAVEaudio");
const request = (body: Uint8Array = wav(), headers: Record<string, string> = {}) => new Request("https://fuse.test/api/import/transcribe", {
  method: "POST", headers: { origin: "https://fuse.test", ...headers }, body: Buffer.from(body),
});
describe("audio transcription boundary", () => {
  beforeEach(() => {
    vi.stubEnv("AI_GATEWAY_API_KEY", ""); vi.stubEnv("VERCEL_OIDC_TOKEN", ""); vi.stubEnv("VERCEL", "1");
    getUser.mockResolvedValue({ data: { user: { id: "owner" } } }); rpc.mockResolvedValue({ data: true, error: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ text: "Enviar proposta amanhã." })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("uses runtime OIDC and returns an editable transcript without creating tasks", async () => {
    const response = await POST(request(wav(), { "x-vercel-oidc-token": "runtime-token" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Enviar proposta amanhã." });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("claim_task_extraction");
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[1]?.headers).toMatchObject({ Authorization: "Bearer runtime-token", "ai-model-id": "openai/whisper-1" });
    expect(JSON.parse(call[1]?.body as string)).toEqual({ audio: wav().toString("base64"), mediaType: "audio/wav" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects unauthenticated requests before provider calls", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request())).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects cross-origin uploads before reading the session", async () => {
    expect((await POST(request(wav(), { origin: "https://attacker.test" }))).status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
  });
  it("bounds streamed audio even without content length", async () => {
    expect((await POST(request(new Uint8Array(MAX_AUDIO_BYTES + 1), { "x-vercel-oidc-token": "token" }))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects renamed non-audio files before consuming quota", async () => {
    expect((await POST(request(Buffer.from("<html>not audio</html>"), { "x-vercel-oidc-token": "token", "content-type": "audio/mpeg" }))).status).toBe(415);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("enforces durable quota before paid inference", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(request(wav(), { "x-vercel-oidc-token": "token" }))).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not accept client OIDC headers outside Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    expect((await POST(request(wav(), { "x-vercel-oidc-token": "token" }))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports unavailable beta model access without exposing provider details", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ secret: "provider-detail" }, { status: 403 }));
    const response = await POST(request(wav(), { "x-vercel-oidc-token": "token" }));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("provider-detail");
  });
  it("rejects silent audio and oversized transcripts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ text: " " })).mockResolvedValueOnce(Response.json({ text: "x".repeat(16001) }));
    expect((await POST(request(wav(), { "x-vercel-oidc-token": "token" }))).status).toBe(422);
    expect((await POST(request(wav(), { "x-vercel-oidc-token": "token" }))).status).toBe(422);
  });
});
