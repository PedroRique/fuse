# Fuse — Implementation Plan

> Your tasks take up space as they run out of time.

This file tracks phases, decisions and known limits. Update it at the end of each phase.

## Architecture

```
UI (React, canvas, dialogs)
  ├─ reads time via lib/clock (useNow: one global ticker, per-card subscriptions)
  ├─ computes everything visual via src/domain (pure, `now` is always passed in)
  └─ mutates via Server Actions (Zod) → Postgres RPCs (atomic, idempotent, RLS) → Supabase
```

- `src/domain` — pure, tested: fuse math, pauses, urgency curve, states, scars, rules, presets, board geometry.
- `supabase/migrations` — schema, RLS, and **every consequential mutation as a `security definer` RPC** that checks `auth.uid()`. Clients have `select` only; no direct insert/update/delete grants.
- `src/server` — Zod schemas + Server Actions (thin: validate, call RPC, map errors).
- `src/components` — UI. No time math inside components besides calling the domain.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 0 | Foundation (Next 16, TS strict, Tailwind 4, shadcn, Vitest, Playwright, local Supabase) | done |
| 1 | Domain engine + unit tests | done |
| 2 | Database, RLS, RPCs, Auth, isolation test | done |
| 3 | Basic board (shell, empty state, canvas, drag, persistence) | done |
| 4 | Create + details + done + history | done |
| 5 | Live urgency + dev time travel | done |
| 6 | Cut the wire | done |
| 7 | Emergency pause | done |
| 8 | Explosion | done |
| 9 | Post-mortem + rebuild | done |
| 10 | Onboarding + polish + PWA | done |
| 11 | QA (E2E + manual) | done |

## Time model

- Stored: `fuse_started_at`, `deadline_at`, pauses (`board_pauses`). Never stored: progress, size, urgency.
- `effectiveElapsed = (now − fuseStartedAt) − overlap(pauses, [fuseStartedAt, now])`
- `remaining = (deadlineAt − fuseStartedAt) − effectiveElapsed`; explosion is due when `remaining ≤ 0`.
- Pauses never rewrite deadlines. The "effective deadline" shown to the user is `now + remaining`.
- The same formula exists in SQL (`task_remaining_ms`) and TS (`getRemainingMs`). The server decides explosions; the client only renders and triggers a sync.
- Server time is the source of truth: the client learns `serverNow − Date.now()` on every board load and applies it to its ticker (covers clock skew and dev time travel).
- Time travel: SQL `app_now()` is `now()` in migrations. `supabase/seed.sql` (local only, never deployed) redefines it as `now() + dev_clock.offset`. The dev panel and `/api/dev/clock` refuse to run unless `NODE_ENV === "development"`.

## Urgency curve

`x = clamp((p − 0.45) / 0.55)`, `scale = 1 + (3.4 − 1)·(e^{4x} − 1)/(e^4 − 1)`.
≈1.02 at 50%, ≈1.35 at 75%, ≈2.1 at 90%, ≈2.7 at 95%, 3.4 at 100%. The canvas additionally clamps scale so a card never exceeds ~70% of the viewport.

States: safe < 50% ≤ active < 75% ≤ warning < 90% ≤ critical; final countdown at ≥ 95%.

## Decisions (small ambiguities resolved)

1. **botherAfter**: before it, the card is dormant (scale 1, neutral). After it, it uses the real fuse progress (no re-based curve). Dormancy never prevents an explosion.
2. **Deadline edits**: below 75% progress, free edit (logs `rescheduled`). At/after 75%, extending requires Cut the Wire (enforced in SQL too). Shortening is always allowed.
3. **Cut the wire** keeps `fuse_started_at` and extends `deadline_at`, so progress drops and the card shrinks. Relative presets (+30 min, +2 h, +3 days) add on top of the time left; "Tomorrow" = end of tomorrow (local).
4. **Reschedule after explosion** relights the fuse: `fuse_started_at = now`.
5. **Fuses keep burning during destroyed/rebuilding.** A task expiring then joins the open incident and needs its own post-mortem. Otherwise a rebuild would be a free infinite pause.
6. **Creating tasks, moving cards, pausing are blocked** while the board is destroyed/rebuilding.
7. **Completing a task whose time is up** is rejected server-side (it must explode). Time is the server's.
8. **Emergency pause** can be ended early ("Resume now"). A pause cannot start while the board is destroyed. No cooldown between pauses in the MVP (known gap).
9. **Multiple simultaneous expiries** create one incident; each exploded task needs a post-mortem.
10. **Rebuild**: every active task at rebuild start must be restored manually (drag into the board, or keyboard "Place on board"). Completed/discarded tasks don't come back. If nothing is left to restore, the incident resolves immediately.
11. `createdBy` from the brief is represented by `user_id` (single-user boards).
12. Extra event types `post_mortem` and `board_restored` were added for analytics completeness.
13. Board events (`emergency_pause_*`, `board_restored`) live in the same `task_events` table with `task_id` null.
14. Canvas overlap is allowed. Most urgent cards sit on top; hover/focus/drag raise a card to the very top; covered cards remain reachable via Tab.
15. A grown card is shifted (visually only) so it never spills outside the board; its stored position stays the center the user chose.
16. PWA is installable (manifest + SVG icon + service worker registered in production only). The service worker is network-only: fuses are server-authoritative, so no offline cache of the board.

## Known limits (ponytail)

- Canvas renders every card; boards with hundreds of cards would need virtualization.
- Service worker caches nothing; offline shows the offline guard instead of a cached board.
- Dev clock offset is global to the local database (E2E runs serially).
