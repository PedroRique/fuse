# Fuse

**Your tasks take up space as they run out of time.**

A task manager on a free canvas. Cards grow non-linearly as their fuse burns down, show a countdown in the last 5%, and explode at zero: the card is scarred permanently, the board is destroyed, and you must write a post-mortem and rebuild the board by hand. Cut the Wire and Emergency Pause exist so that real life doesn't get punished.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind 4 · shadcn/ui (Base UI) · Supabase (Postgres, Auth, RLS) · dnd-kit · Zod · React Hook Form · date-fns · Vitest · Playwright.

## Run locally

Requirements: Node 22+, pnpm, Docker.

```bash
pnpm install
pnpm db:start            # local Supabase (DB, Auth, REST, mail)
pnpm db:reset            # apply migrations + local-only seed (dev clock)
pnpm db:env              # copy API_URL / ANON_KEY / SERVICE_ROLE_KEY into .env.local (see .env.example)
pnpm dev                 # http://127.0.0.1:4317
```

Magic-link emails land in the local mail inbox at http://127.0.0.1:54324.

## Scripts

| Script | What it does |
|---|---|
| `pnpm test` | Domain unit tests (Vitest) |
| `pnpm test:db` | RLS / RPC integration tests against local Supabase |
| `pnpm test:e2e` | Playwright critical flows (uses dev time travel) |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Quality gates |

## Time travel (development only)

In `pnpm dev`, a small "Dev clock" panel at the bottom-left lets you jump forward in time (server and client). It doesn't exist in production builds, and the backing SQL is only installed by the local seed.

## Layout

- `src/domain` — pure time/urgency/scar/rule logic (all tested).
- `supabase/migrations` — schema, RLS and atomic RPCs.
- `src/server` — Zod schemas and Server Actions.
- `src/components` — board, dialogs, incident flow, history.

See `IMPLEMENTATION_PLAN.md` for decisions and progress.
