"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { formatDuration } from "@/domain/time";

const JUMPS = [
  ["+10m", 10 * 60_000],
  ["+1h", 3_600_000],
  ["+6h", 6 * 3_600_000],
  ["+1d", 86_400_000],
] as const;

/** Development-only. Moves the server clock (app_now) and therefore the client clock too. */
export function TimeTravelPanel({ getNextDeadlineInMs }: { getNextDeadlineInMs: () => number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState<number | null>(null);

  async function travel(body: { advanceMs?: number; reset?: true }) {
    const res = await fetch("/api/dev/clock", { method: "POST", body: JSON.stringify(body) });
    const json = (await res.json()) as { offsetMs: number };
    setOffset(json.offsetMs);
    router.refresh();
  }

  return (
    <div className="fixed bottom-3 left-3 z-[200000] font-mono text-xs">
      {open ? (
        <div className="w-60 space-y-2 rounded-lg border border-dashed border-stone-400 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Dev clock</span>
            <button onClick={() => setOpen(false)} aria-label="Close dev clock" className="text-stone-500">
              ×
            </button>
          </div>
          <p className="text-stone-500">Offset: {offset === null ? "?" : offset === 0 ? "none" : `+${formatDuration(offset)}`}</p>
          <div className="grid grid-cols-4 gap-1">
            {JUMPS.map(([label, ms]) => (
              <button key={label} className="rounded border px-1 py-1 hover:bg-stone-100" onClick={() => travel({ advanceMs: ms })}>
                {label}
              </button>
            ))}
          </div>
          <button
            className="w-full rounded border px-2 py-1 hover:bg-stone-100"
            onClick={() => {
              const next = getNextDeadlineInMs();
              if (next !== null) void travel({ advanceMs: Math.max(0, next - 15_000) });
            }}
          >
            Next deadline − 15s
          </button>
          <button className="w-full rounded border px-2 py-1 hover:bg-stone-100" onClick={() => travel({ reset: true })}>
            Reset to real time
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-stone-400 bg-white/90 px-3 py-1.5 shadow"
          data-testid="dev-clock-toggle"
        >
          <Clock className="size-3" aria-hidden /> Dev clock
        </button>
      )}
    </div>
  );
}
