# Zero-budget deployment preparation — 2 November 2026

Code preparation is complete. Actual Vercel deployment, hosted schema/Auth activation and public multiplayer acceptance testing remain for the deployment session.

## Changes

- Replaced Clerk application dependencies, session providers, server identity checks and login/signup UI with native Supabase Auth. The user chose email/password and approved retaining current hosted Auth settings.
- Auth users own profiles by UUID. The native profile trigger grants no admin rights from metadata and handles duplicate usernames without merging identities by email. Historical identities and room ownership are preserved.
- Added a private, disabled-by-default Supabase scheduler using Cron, pg_net and Vault. It sends authenticated HTTP only at persisted deadlines, serializes outstanding requests, retries temporary errors, and handles resume/mini selection deadlines. No Fly account is needed.
- Removed the serverless post-response resume timeout. Added production environment/build checks, Vercel settings, migration rehearsal, CI checks and updated deployment instructions.
- Corrected the deferred bot engine's existing guarded-RPC wiring while keeping bots disabled. The production scheduler targets human rooms.

## Validation

- Fresh production build: PASS with hosted placeholder configuration, Node 24 / Next.js 15.5.28. It compiled, generated all routes and verified that /api/diag is absent. This verifies compilation, not live hosted credentials. Six existing non-blocking lint warnings remain.
- Full local Vitest suite: 1,024 passed, zero failed; 74 skipped because optional isolated runtime targets were unset or bot functionality is disabled. Skips are not counted as runtime verification.
- All 75 canonical migrations replayed successfully in a new PostgreSQL 17 container with no network and no published ports.
- Transactional database rehearsal: PASS for unprivileged profile creation, duplicate-name fallback, protected admin fields, native UUID resolution, real room create/join/start, human bidding, sold/unsold settlement, purse/squad updates and mini-auction initiation.
- Scheduler SQL rehearsal: PASS for disabled installation, future-timer idleness, due dispatch, one outstanding request, shared-secret headers, timeout, retry/backoff, recovery, pause/resume deadline, mini selection expiry with a completed parent and invalid-credential shutdown. Vault and HTTP transport were mocked; hosted integration still needs verification.
- Production HTTP smoke: PASS for login/signup pages, protected dashboard redirect, signed-out profile API, unauthenticated tick rejection and diagnostic 404.
- Chromium at 375×812: PASS for email login/signup controls, session initialization, no Google button, no horizontal overflow and no browser runtime exceptions. No real login request or hosted data mutation occurred.

The final production build used a fresh source-only folder because a second build in the existing Windows cache encountered EPERM. The clean build succeeded. Old recovery folders, backups and unrelated untracked artifacts were preserved.

## Hosted facts and next session

Read-only verification found the linked MegaMockAuction project healthy: Google disabled, email/password enabled, signup allowed and email auto-confirm already enabled. The user approved keeping those settings. No hosted Auth settings, migrations, cron jobs, Vault secrets or deployment were changed during preparation.

Next: configure the five real Vercel values, inspect/backup/apply pending hosted migrations, update Auth redirect URLs and retire Clerk trust, verify the player catalog/Realtime publication, deploy Vercel, install and enable the scheduler, then test two-device auctions, reconnection, trades and complete mini-auction flow. Follow docs/DEPLOYMENT.md.

Public password-reset email requires a configured SMTP provider; the default sender is restricted. Free hosting allowances and pauses mean uninterrupted or unlimited public usage cannot be guaranteed. No paid service was enabled.
