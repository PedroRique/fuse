import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { HistoryItem } from "@/components/history/history-item";
import { getProfile, loadHistory } from "@/server/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "History — Fuse" };

const FILTERS = {
  all: { label: "All", types: null },
  completed: { label: "Completed", types: ["completed"] },
  exploded: { label: "Exploded", types: ["exploded"] },
  wires: { label: "Cut wires", types: ["wire_cut"] },
  emergency: { label: "Emergency", types: ["emergency_pause_started", "emergency_pause_ended"] },
} as const;
type FilterKey = keyof typeof FILTERS;

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  if (!(await getProfile())) redirect("/login");
  const { filter } = await searchParams;
  const key: FilterKey = typeof filter === "string" && filter in FILTERS ? (filter as FilterKey) : "all";
  const entries = await loadHistory(FILTERS[key].types ? [...FILTERS[key].types!] : null);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="history" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything that happened on your board. Nothing here is ever deleted.</p>

        <nav aria-label="Filter history" className="mt-6 flex flex-wrap gap-1.5">
          {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
            <Link
              key={k}
              href={k === "all" ? "/history" : `/history?filter=${k}`}
              aria-current={k === key ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium transition-colors hover:border-stone-400",
                k === key && "border-stone-900 bg-stone-900 text-white hover:border-stone-900",
              )}
            >
              {FILTERS[k].label}
            </Link>
          ))}
        </nav>

        {entries.length === 0 ? (
          <p className="mt-16 text-center text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ol className="mt-6 divide-y rounded-xl border bg-card" data-testid="history-list">
            {entries.map((e) => (
              <HistoryItem key={e.id} entry={e} />
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
