# AI task import (text MVP)

Board → Import → paste source or record/upload audio → transcribe and edit text
→ Find tasks → edit/select → Create tasks.
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

Audio: the browser records with MediaRecorder (WebM/Opus or MP4 on Safari).
Recordings stop at two minutes or when the app goes into the background.
Uploads and recordings are bounded to 3 MiB; the server independently bounds the
stream and checks the audio container signature. Supported containers: MP3,
MP4/M4A, WAV, WebM, Ogg, FLAC. Uploaded files have a byte limit, not a trusted
duration limit. The microphone is allowed only for the app's own origin and is
requested only after clicking Record. Tracks, timers, preview URLs and requests
are released when the audio component unmounts.

Transcription uses the Gateway REST v4 transcription endpoint with the current
request OIDC token. Default model: openai/whisper-1, verified in the live catalog;
override via server-only AI_GATEWAY_TRANSCRIPTION_MODEL. This Gateway capability
is in beta and requires team model access/credits. The app reports access errors
and keeps the clip for retry. Audio is sent only on Transcribe and is not stored
in Supabase. Provider/Gateway retention depends on service configuration.
The transcript is editable before analysis; no tasks are created by transcription.
Transcription and extraction each consume one request from the shared quota of
3/minute and 20/day. Thus one full audio import uses two AI requests.

Verification: domain and transcription API tests, supabase/tests/task_import.sql (rollback fixtures),
typecheck/build, authenticated browser flow and one small inference smoke test
when team credits/access are available. CSV/document support is a later step
using this same review and commit boundary.
