import { WHAT_HAPPENED, type TaskEvent } from "@/domain/types";
import { describeExplosions } from "@/domain/scars";
import { formatDuration } from "@/domain/time";

const reasonLabel = (r: unknown) => WHAT_HAPPENED.find((w) => w.value === r)?.label ?? String(r ?? "");

type Described = { title: string; detail?: string; reason?: string };

export function describeEvent(e: TaskEvent, explosionCount = 0): Described {
  const m = e.metadata as Record<string, unknown>;
  switch (e.type) {
    case "created":
      return { title: "Fuse lit", detail: m.fuseMs ? `Fuse: ${formatDuration(Number(m.fuseMs))}` : undefined };
    case "completed": {
      const count = Number(m.explosionCount ?? explosionCount);
      return { title: "Completed", detail: `Completed ${describeExplosions(count)}` };
    }
    case "wire_cut":
      return {
        title: "Wire cut",
        detail: `+${formatDuration(Number(m.addedMs ?? 0))}`,
        reason: `${reasonLabel(m.reason)}${m.explanation ? ` — “${m.explanation}”` : ""}`,
      };
    case "exploded": {
      const n = Number(m.explosionCount ?? 1);
      return { title: "Exploded", detail: n === 1 ? "Exploded once" : `Explosion #${n}`, reason: m.fuseMs ? `Fuse: ${formatDuration(Number(m.fuseMs))}` : undefined };
    }
    case "rescheduled":
      return {
        title: m.source === "post_mortem" ? "Relit after explosion" : "Deadline changed",
        detail: m.addedMs !== undefined ? `${Number(m.addedMs) >= 0 ? "+" : "−"}${formatDuration(Number(m.addedMs))}` : m.fuseMs ? `New fuse: ${formatDuration(Number(m.fuseMs))}` : undefined,
      };
    case "discarded":
      return { title: "Discarded", reason: m.reason ? `“${m.reason}”` : undefined };
    case "post_mortem":
      return { title: "Post-mortem", reason: `${reasonLabel(m.reason)} — “${m.explanation}”` };
    case "emergency_pause_started":
      return { title: "Emergency pause", detail: m.plannedDurationMs ? formatDuration(Number(m.plannedDurationMs)) : undefined, reason: m.reason ? `“${m.reason}”` : undefined };
    case "emergency_pause_ended":
      return { title: m.endedEarly ? "Pause ended early" : "Pause ended", detail: m.durationMs ? `Paused for ${formatDuration(Number(m.durationMs))}` : undefined };
    case "board_restored":
      return { title: "Board restored", detail: `${m.restoredCount ?? 0} cards put back` };
  }
}
