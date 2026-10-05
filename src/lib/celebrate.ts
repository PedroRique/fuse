const HEADLINES = ["You did it.", "That's a check.", "One less fuse."] as const;

/** Stable line per title so the same task doesn't shuffle copy on retry. */
export function completeHeadline(title: string) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h + title.charCodeAt(i) * (i + 1)) % HEADLINES.length;
  return HEADLINES[h];
}

export function completeToast(title: string, explosionCount = 0) {
  if (explosionCount > 0) {
    return { title: "You still finished it.", description: `${title} · the scar stays.` };
  }
  return { title: completeHeadline(title), description: title };
}

let ctx: AudioContext | null = null;

function audio() {
  const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx ??= new C();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Short C-major arpeggio. Fired from the Done click, so the browser allows audio. */
export function playCompleteChime() {
  try {
    const ac = audio();
    const t0 = ac.currentTime;
    (
      [
        [523.25, 0],
        [659.25, 0.07],
        [783.99, 0.14],
      ] as const
    ).forEach(([freq, delay]) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = t0 + delay;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.1, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(start);
      osc.stop(start + 0.38);
    });
  } catch {
    // Autoplay / missing AudioContext — the visual stamp still fires.
  }
}
