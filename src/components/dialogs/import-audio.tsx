"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUDIO_ACCEPT, MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from "@/domain/audio-import";

export function ImportAudio({ disabled, hasText, onTranscript, onActiveChange }: {
  disabled?: boolean; hasText: boolean; onTranscript: (text: string) => void; onActiveChange: (active: boolean) => void;
}) {
  const [clip, setClip] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const active = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const preview = useRef<string | null>(null);
  const upload = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onActive = useRef(onActiveChange);
  useEffect(() => { onActive.current = onActiveChange; }, [onActiveChange]);

  function releaseMicrophone() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }
  useEffect(() => {
    alive.current = true;
    const stopWhenHidden = () => {
      if (document.hidden && recorder.current?.state === "recording") recorder.current.stop();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", stopWhenHidden);
      if (recorder.current?.state === "recording") recorder.current.stop();
      releaseMicrophone();
      upload.current?.abort();
      if (preview.current) URL.revokeObjectURL(preview.current);
      onActive.current(false);
    };
  }, []);

  function choose(blob: Blob, name: string) {
    if (blob.size === 0 || blob.size > MAX_AUDIO_BYTES) {
      setError("Choose audio between 1 byte and 3 MB, or record a shorter voice note.");
      return;
    }
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = URL.createObjectURL(blob);
    setClip({ blob, url: preview.current, name });
    setError(null);
  }
  async function start() {
    if (active.current || disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording isn't supported in this browser. Upload an audio file instead."); return;
    }
    active.current = true; setBusy(true); onActive.current(true); setError(null);
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(microphone, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      recorder.current = next;
      const chunks: Blob[] = [];
      let bytes = 0;
      next.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
        if (bytes >= MAX_AUDIO_BYTES && next.state === "recording") next.stop();
      };
      next.onstop = () => {
        releaseMicrophone(); active.current = false;
        if (!alive.current) return;
        setRecording(false); setBusy(false); onActive.current(false);
        const blob = new Blob(chunks, { type: next.mimeType || mimeType || "audio/webm" });
        choose(blob, "Voice note");
      };
      next.onerror = () => {
        releaseMicrophone(); active.current = false;
        if (alive.current) { setRecording(false); setBusy(false); onActive.current(false); setError("Recording failed. Try again or upload a file."); }
      };
      next.start(1000); setRecording(true); setBusy(false); setSeconds(0);
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS && next.state === "recording") next.stop();
      }, 500);
    } catch (e) {
      releaseMicrophone(); active.current = false;
      if (alive.current) {
        setBusy(false); onActive.current(false);
        setError(e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission denied. Allow it in your browser settings, or upload an audio file."
          : "Couldn't access the microphone. Try again or upload a file.");
      }
    }
  }
  async function transcribe() {
    if (!clip || active.current || disabled) return;
    active.current = true; setBusy(true); onActive.current(true); setError(null);
    const controller = new AbortController(); upload.current = controller;
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch("/api/import/transcribe", {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: clip.blob, signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn't transcribe the audio.");
      if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech found.");
      if (alive.current) onTranscript(result.text);
    } catch (e) {
      if (alive.current) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "Transcription timed out. Your audio is still here; retry or use a shorter recording.");
    } finally {
      clearTimeout(timeout); upload.current = null; active.current = false;
      if (alive.current) { setBusy(false); onActive.current(false); }
    }
  }
  return <section className="space-y-3 rounded-lg border p-3" aria-label="Audio import">
    <p className="font-medium">Record or upload audio</p>
    <div className="flex flex-wrap gap-2">
      {recording ? <Button variant="destructive" onClick={() => recorder.current?.stop()}><Square aria-hidden />Stop recording</Button>
        : <Button variant="outline" disabled={busy || disabled} onClick={start}><Mic aria-hidden />{busy && !clip ? "Opening microphone…" : "Record voice note"}</Button>}
      <Button variant="outline" disabled={recording || busy || disabled} onClick={() => fileInput.current?.click()}><Upload aria-hidden />Upload audio</Button>
      <input ref={fileInput} type="file" accept={AUDIO_ACCEPT} className="hidden" aria-label="Choose audio file" onChange={event => {
        const file = event.target.files?.[0]; if (file) choose(file, file.name); event.target.value = "";
      }} />
    </div>
    {recording && <p role="status" className="text-sm text-destructive">Recording · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} / 2:00</p>}
    {clip && !recording && <div className="space-y-2">
      <p className="break-all text-sm">{clip.name} · {(clip.blob.size / 1024 / 1024).toFixed(2)} MB</p>
      <audio src={clip.url} controls className="w-full" />
      {hasText && <p className="text-xs text-muted-foreground">Transcribing replaces the text currently in the editor.</p>}
      <Button disabled={busy || disabled} onClick={transcribe}>{busy && <LoaderCircle className="animate-spin" aria-hidden />}{busy ? "Transcribing…" : "Transcribe audio"}</Button>
    </div>}
    <p className="text-xs text-muted-foreground">Voice notes up to 2 minutes. Files up to 3 MB: MP3, M4A, WAV, WebM, Ogg or FLAC. Audio is sent to our AI provider only when you click Transcribe. Review the transcript, then find and approve your tasks.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
