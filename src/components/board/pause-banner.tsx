"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNow } from "@/lib/clock";
import { formatCountdown } from "@/domain/time";
import type { BoardPause } from "@/domain/types";
import { endPause } from "@/server/actions";

export function PauseBanner({ pause, onEnded }: { pause: BoardPause; onEnded: () => void }) {
  const now = useNow();
  const [pending, setPending] = useState(false);
  const remaining = Date.parse(pause.plannedEndAt) - now;

  async function resume() {
    setPending(true);
    const res = await endPause();
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast("Pause ended.", { description: "Your fuses are burning again." });
    onEnded();
  }

  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b bg-stone-900 px-4 py-2 text-sm text-stone-100">
      <span className="inline-flex items-center gap-2 font-semibold tracking-[0.2em]">
        <Pause className="size-3.5" aria-hidden /> BOARD PAUSED
      </span>
      <span className="text-stone-300">
        Emergency pause ends in <span className="font-mono text-stone-50 tabular-nums" data-testid="pause-countdown">{formatCountdown(remaining)}</span>
      </span>
      <span className="hidden text-stone-400 sm:inline">“{pause.reason}”</span>
      <Button size="sm" variant="secondary" onClick={resume} disabled={pending}>
        Resume now
      </Button>
    </div>
  );
}
