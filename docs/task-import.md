# AI task import (text MVP)

Board → Import → paste source → Find tasks → edit/select → Create tasks.
Maximum 16,000 characters and 30 tasks per batch. Missing dates remain blank and
must be assigned before creation. Missing priorities use the ordinary Normal
default, explicitly labelled in review. Bulk fields fill missing values unless
the user checks replacement. Possible duplicates are unselected initially.

Source excerpts remain visible during review. Source text is sent only after
Find tasks is clicked and is not stored in the database. The inference provider
is Google via Vercel AI Gateway. Provider/Gateway request logging and retention
are governed by their service configuration; do not claim zero retention.

The server uses the documented Gateway Chat Completions HTTP API (no SDK/runtime
upgrade is required). Authentication uses the per-request x-vercel-oidc-token
header in Vercel Functions, VERCEL_OIDC_TOKEN for linked local development, or a
server-only AI_GATEWAY_API_KEY for local development. AI_GATEWAY_MODEL optionally
overrides the verified default google/gemini-3.5-flash-lite. The Vercel team must
have Gateway access/credits; this feature does not purchase credits or enable a
paid plan. If access fails, the source remains in the dialog with an error.

Authentication, same-origin requests, schema validation, a 70 KiB streamed body
limit, 45-second provider timeout and per-account quotas precede inference.
Quota: 3 analyses/minute, 20/day. The model has no tools or database access.
All suggestions remain untrusted and require server and database validation.

Import is a single transaction, uses existing task quotas (30 created/minute,
200/day and board limits), and rolls back completely on input/quota errors.
An account-scoped request UUID and payload hash make identical retries return
the original task IDs. A changed replay is rejected. Existing sort/tidy handles
the newly refreshed task set. Creation requires explicit confirmation; no
automatic creation is enabled in this MVP.

Verification: domain tests, supabase/tests/task_import.sql (rollback fixtures),
typecheck/build, authenticated browser flow and one small inference smoke test
when team credits/access are available. CSV/file/audio support is a later step
using this same review and commit boundary.
