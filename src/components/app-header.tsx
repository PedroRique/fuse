"use client";

import Link from "next/link";
import { ArrowUpDown, Check, Eye, EyeOff, LayoutGrid, LogOut, Plus, Siren } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { Button, buttonVariants } from "@/components/ui/button";
import { signOut } from "@/server/actions";
import { cn } from "@/lib/utils";
import type { BoardSort } from "@/domain/layout";

const SORTS: { value: BoardSort; label: string; hint: string }[] = [
  { value: "severity", label: "Severity", hint: "Critical impact first" },
  { value: "deadline", label: "Deadline", hint: "Soonest due first" },
  { value: "fuse", label: "Fuse", hint: "Most burned first" },
];

export function AppHeader({
  active,
  onNewTask,
  onEmergency,
  onTidy,
  onSort,
  newTaskDisabled,
  emergencyDisabled,
  arrangeDisabled,
  sortBy,
  hideCompleted,
  completedCount = 0,
  onToggleCompleted,
}: {
  active: "board" | "history";
  onNewTask?: () => void;
  onEmergency?: () => void;
  onTidy?: () => void;
  onSort?: (by: BoardSort) => void;
  newTaskDisabled?: boolean;
  emergencyDisabled?: boolean;
  arrangeDisabled?: boolean;
  sortBy?: BoardSort;
  hideCompleted?: boolean;
  completedCount?: number;
  onToggleCompleted?: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-background/90 px-3 py-2.5 backdrop-blur sm:gap-4 sm:px-6">
      <Link href="/board" className="mr-1 font-mono text-sm font-semibold tracking-[0.3em] sm:mr-4">
        FUSE
      </Link>
      <nav aria-label="Main" className="flex gap-1 text-sm">
        {(
          [
            ["board", "/board", "Board"],
            ["history", "/history", "History"],
          ] as const
        ).map(([key, href, label]) => (
          <Link
            key={key}
            href={href}
            aria-current={active === key ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground",
              active === key && "bg-muted text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {onToggleCompleted && <Button variant="outline" onClick={onToggleCompleted} aria-pressed={hideCompleted} aria-label={hideCompleted ? `Show completed tasks (${completedCount})` : `Hide completed tasks (${completedCount})`} title={hideCompleted ? "Show completed tasks" : "Hide completed tasks"}>
          {hideCompleted ? <EyeOff aria-hidden /> : <Eye aria-hidden />}<span className="hidden sm:inline">Done ({completedCount})</span>
        </Button>}
        {onTidy && (
          <Button variant="outline" onClick={onTidy} disabled={arrangeDisabled} data-testid="tidy-board" aria-label="Tidy board">
            <LayoutGrid aria-hidden /> <span className="hidden sm:inline">Tidy</span>
          </Button>
        )}
        {onSort && (
          <Menu.Root>
            <Menu.Trigger
              disabled={arrangeDisabled}
              data-testid="sort-board"
              aria-label="Sort board"
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowUpDown aria-hidden className="size-4" /> <span className="hidden sm:inline">Sort</span>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} className="z-[200000]">
                <Menu.Popup className="min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
                  {SORTS.map((s) => (
                    <Menu.Item
                      key={s.value}
                      onClick={() => onSort(s.value)}
                      className="flex cursor-default flex-col rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted"
                    >
                      <span className="flex items-center gap-2 font-medium">{s.label}{sortBy === s.value && <Check className="size-3" aria-label="Selected" />}</span>
                      <span className="text-xs text-muted-foreground">{s.hint}</span>
                    </Menu.Item>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
        {onEmergency && (
          <Button variant="outline" onClick={onEmergency} disabled={emergencyDisabled} aria-label="Emergency pause">
            <Siren aria-hidden /> <span className="hidden sm:inline">Emergency</span>
          </Button>
        )}
        {onNewTask && (
          <Button onClick={onNewTask} disabled={newTaskDisabled} data-testid="new-task">
            <Plus aria-hidden /> <span className="hidden sm:inline">New Task</span>
            <span className="sr-only sm:hidden">New Task</span>
          </Button>
        )}
        <form action={async () => {
          // Stop notifications on shared devices before ending the authenticated session.
          if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            const subscription = await registration?.pushManager?.getSubscription();
            if (subscription) {
              const { removePushSubscription } = await import("@/server/push-actions");
              const result = await removePushSubscription(subscription.endpoint);
              if (result.error) { alert(result.error); return; }
              await subscription.unsubscribe();
            }
          }
          await signOut();
        }}>
          <Button variant="ghost" size="icon" type="submit" aria-label="Sign out">
            <LogOut aria-hidden />
          </Button>
        </form>
      </div>
    </header>
  );
}
