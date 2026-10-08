export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 120;
export const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.mp4,.wav,.webm,.ogg,.flac";

// Check the container instead of trusting an uploaded filename or MIME type.
export function detectAudioType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 12) return null;
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(4, 8) === "ftyp") return "audio/mp4";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  return null;
}
