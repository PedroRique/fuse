import Link from "next/link";
import { LogOut, Plus, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/server/actions";
import { cn } from "@/lib/utils";

export function AppHeader({
  active,
  onNewTask,
  onEmergency,
  newTaskDisabled,
  emergencyDisabled,
}: {
  active: "board" | "history";
  onNewTask?: () => void;
  onEmergency?: () => void;
  newTaskDisabled?: boolean;
  emergencyDisabled?: boolean;
}) {
  return (
    <header className="flex items-center gap-2 border-b bg-background/90 px-3 py-2.5 backdrop-blur sm:gap-4 sm:px-6">
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
        <form action={signOut}>
          <Button variant="ghost" size="icon" type="submit" aria-label="Sign out">
            <LogOut aria-hidden />
          </Button>
        </form>
      </div>
    </header>
  );
}
