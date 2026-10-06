# Production security

Database authorization remains the enforcement boundary: authenticated RPCs
validate ownership; reads use owner RLS; privileged dispatch functions are
service-role only. Publishable Supabase and public VAPID keys are intentionally
public. Never expose service-role, cron, or private VAPID credentials.

## Enforced limits

- Board mutations: 120 successful calls per account per minute, across RPCs.
- Task creation: 30/minute, 200/24 hours, 500 active and 5,000 total per account.
- Push subscriptions: 10/account, 20 new registrations/hour.
- Notification tests: 3/minute and 20/hour per account, plus one/device/minute.
- Push Edge request bodies: 4 KiB maximum. Authentication precedes configuration.

Counters use private rows and transactional upserts, not process memory. Task and
device quotas serialize concurrent inserts. Rejected mutations roll back their
counter updates with the transaction; these quotas bound successful writes, not
the processing cost of every rejected request. IP-level abuse and login/signup
protection must also be enforced at the hosting/Auth gateways. A Vercel-only
rule cannot protect calls sent directly to the Supabase API.

New or updated subscriptions enforce push-provider hosts and base64url keys in
the database. Legacy rows are preserved during rollout; the sender independently
rejects unsupported endpoints. No historical task/device data is deleted.

## Browser

Request-specific CSP nonces allow Next.js scripts without permitting arbitrary
inline JavaScript. Pages render dynamically so nonce and HTML match. Inline CSS
remains allowed for canvas positioning and popovers. CSP allows only this app
and its configured Supabase origin for production connections, same-origin
workers/manifests, and prevents framing, plugins, and foreign form submissions.
Other headers include nosniff, DENY, referrer/permissions policy and HTTPS HSTS.

## Operations still required

Enable MFA on GitHub, Vercel and Supabase administrator accounts. Review Auth
email confirmation, CAPTCHA and rate limits. Leaked-password rejection requires
Supabase Pro or higher. Configure traffic/error/cost alerts and test backup
restoration. Review dependency advisories regularly. None of these operational
settings are implied by the code hardening.

Run `supabase/tests/security.sql` against a disposable database, or inside its
existing rollback transaction using an admin SQL connection. It creates only
temporary fixture users and rolls back every write, including counters.
