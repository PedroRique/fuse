# Web Push

Use **Notifications → Enable notifications → Send test** on each device.
On iOS/iPadOS 16.4+, install Fuse using Add to Home Screen and enable from the installed app.
Android Chrome and desktop Chrome can subscribe directly. Delivery depends on OS permissions,
connectivity and background restrictions. The browser controls sound and lock-screen display.

## Architecture

- `public/sw.js` displays push messages and opens the task from notification taps.
- Server actions validate and save subscriptions through the authenticated user's RLS session.
- `fuse-push` Supabase Edge Function validates user JWTs for test messages, or a private scheduler
  token for background dispatch. Gateway JWT verification is disabled because cron uses custom authentication.
- Supabase Cron invokes the function every minute when devices exist. It uses `pg_net` and Vault.
- Vault names: `fuse_push_public`, `fuse_push_private`, `fuse_push_cron`, `fuse_push_url`.
  VAPID keys are a P-256 pair. Never commit the private key or scheduler token.
- Only `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is configured in Vercel. The Edge Function uses its built-in
  service-role environment to read Vault via a service-role-only RPC.
- Warnings start at 75%, critical alerts at 90%. No expired/completed/discarded tasks, dormant tasks,
  paused boards or open incidents are sent. The same SQL time helpers account for past pauses.
- Delivery markers identify device, task, fuse start, deadline and stage. Critical alerts supersede
  unsent warnings. Retries run after five minutes, at most five attempts. Expired device endpoints
  (404/410) are removed. Provider acceptance cannot guarantee receipt; retries can produce a duplicate
  after an interrupted acknowledgement, so the same task notification tag replaces earlier alerts.
- Disabling or signing out removes the device subscription. Other devices keep their preferences.

## Provisioning another environment

Apply migrations, provision the four Vault secrets, deploy `supabase/functions/fuse-push/index.ts`
with custom authentication and `verify_jwt=false`, and configure the public VAPID key in Vercel.
`fuse_push_url` must point to that project's `/functions/v1/fuse-push` endpoint.
The hosted production project has already been provisioned.

## Verification

Check `cron.job` and `cron.job_run_details` for `fuse-web-push`, and `net._http_response`
for HTTP outcomes. SQL fixtures should run in a rolled-back transaction, checking stage transitions,
duplicate claims, pause/bother-after suppression, completion and service-only RPC permissions.
Use Send test on a real authorized device to confirm delivery, then close the app and tap the notification.
