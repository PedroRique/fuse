"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { TaskCardFace } from "@/components/board/task-card-face";
import { getTaskTemporalState } from "@/domain/urgency";
import type { Task } from "@/domain/types";
import { completeOnboarding } from "@/server/actions";

const H = 3_600_000;
const demoTask = (title: string, impact: Task["impact"], explosionCount = 0): Task => ({
  id: title,
  userId: "",
  boardId: "",
  title,
  notes: null,
  createdAt: new Date(0).toISOString(),
  fuseStartedAt: new Date(0).toISOString(),
  deadlineAt: new Date(100 * H).toISOString(),
  botherAfter: null,
  impact,
  status: "active",
  explosionCount,
  completedAt: null,
  discardedAt: null,
  positionX: 0,
  positionY: 0,
  updatedAt: new Date(0).toISOString(),
});

const STAGES = [
  { label: "Create", pct: 0.05 },
  { label: "Grow", pct: 0.62 },
  { label: "Warning", pct: 0.8 },
  { label: "Critical", pct: 0.965 },
  { label: "Explosion", pct: 1 },
] as const;

export function Onboarding() {
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, startTransition] = useTransition();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground">STEP {step} OF 2</p>

      {step === 1 ? (
        <section className="motion-safe:animate-[rise-in_500ms_ease-out]" aria-labelledby="ob-1">
          <h1 id="ob-1" className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Your tasks take up space as they run out of time.
          </h1>
          <div className="relative mt-12 flex h-72 items-center justify-center gap-10 overflow-hidden rounded-2xl border bg-muted/30" aria-hidden>
            <div className="scale-90">
              <TaskCardFace task={demoTask("Buy a gift for Ana", "low")} temporal={getTaskTemporalState(demoTask("x", "low"), [], 20 * H)} animate={false} />
            </div>
            <div className="origin-center motion-safe:animate-[demo-grow_6s_ease-in_infinite_alternate]">
              <TaskCardFace task={demoTask("Send the proposal", "high")} temporal={getTaskTemporalState(demoTask("x", "high"), [], 93 * H)} />
            </div>
          </div>
          <p className="mt-6 max-w-xl text-muted-foreground">
            A task that can wait three months stays small. A task due in twenty minutes takes over your screen.
          </p>
          <Button size="lg" className="mt-8 tracking-[0.2em]" onClick={() => setStep(2)} autoFocus>
            NEXT
          </Button>
        </section>
      ) : (
        <section className="motion-safe:animate-[rise-in_500ms_ease-out]" aria-labelledby="ob-2">
          <h1 id="ob-2" className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            Don&apos;t let them explode.
          </h1>
          <ol className="mt-10 grid grid-cols-5 gap-2 text-center text-xs font-medium sm:text-sm">
            {STAGES.map((s, i) => (
              <li key={s.label} className="flex flex-col items-center gap-3">
                <span
                  aria-hidden
                  className={
                    s.pct === 1
                      ? "flex size-12 items-center justify-center rounded-full bg-stone-950 text-xl"
                      : "rounded-md border bg-white"
                  }
                  style={s.pct === 1 ? undefined : { width: 18 + i * 9, height: 12 + i * 6, backgroundColor: `color-mix(in oklch, white, ${i >= 3 ? "#dc2626" : "#f97316"} ${i * 7}%)` }}
                >
                  {s.pct === 1 ? "💥" : null}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
          <div className="mt-10 max-w-xl space-y-3 text-muted-foreground">
            <p className="text-foreground">Finish the task or cut the wire before time runs out.</p>
            <p>Explosions damage cards permanently and destroy your board.</p>
          </div>
          <div className="mt-8 flex gap-3">
            <Button size="lg" className="tracking-[0.2em]" disabled={pending} onClick={() => startTransition(() => void completeOnboarding())} autoFocus>
              {pending ? "BUILDING…" : "BUILD MY BOARD"}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
