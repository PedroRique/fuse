import { Check } from "lucide-react";

/** Stamp that lands on the card the moment the server confirms Done. */
export function CompleteStamp() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]" data-testid="complete-stamp" aria-hidden>
      <div className="absolute inset-0 bg-emerald-400/40 motion-safe:animate-[complete-wash_900ms_ease-out_forwards]" />
      <div className="absolute inset-0 grid place-items-center">
        <span className="absolute size-16 rounded-full border-2 border-emerald-500 motion-safe:animate-[stamp-ring_700ms_ease-out_forwards]" />
        <span className="relative grid size-14 place-items-center rounded-full bg-emerald-600 text-white shadow-[0_8px_28px_rgb(5,150,105,0.5)] motion-safe:animate-[check-pop_420ms_cubic-bezier(0.2,1.6,0.3,1)_both]">
          <Check className="size-8" strokeWidth={3} />
        </span>
      </div>
    </div>
  );
}
