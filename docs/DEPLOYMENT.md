# Mega Auction V4: zero-budget launch

Prepared 2 November 2026. This guide replaces the old Fly/Clerk launch instructions. Actual Vercel deployment and hosted activation are deferred to the next deployment session.

## Architecture

- Vercel Hobby serves the Next.js app on its free vercel.app address. No custom domain is required for native Supabase Auth. Hobby is for personal, non-commercial use.
- Supabase Free supplies PostgreSQL, native email/password authentication and Realtime. No Fly account, card, paid worker or Vercel Cron is required for this configuration.
- Supabase Cron checks persisted auction deadlines every second. It calls the authenticated Vercel tick endpoint only when get-ready, bidding, resume or mini-selection deadlines are due. Human bids go directly through authenticated database RPCs.
- The scheduler permits one outstanding HTTP request, retries transient failures with backoff, stops on authentication/configuration failures, and prunes only its own job history. A cold function or network delay can delay a transition beyond one second.
- Bot opponents remain disabled for this human-room release. Do not turn them on with this due-only scheduler.

## Current account decisions

The user approved native Supabase Auth and email/password first launch, retaining current settings. Read-only verification found project MegaMockAuction (zkrxuowctprncwnymnvg) healthy, Google disabled, email enabled, signup allowed, and email auto-confirm already enabled. No hosted Auth setting was changed. Google is not offered in the launch UI.

Email auto-confirm means ownership of an email address is not verified. Do not treat email text as an account ownership proof. Server authorization uses verified Auth UUIDs and database RLS. Existing Clerk profiles, mappings, rooms and squads are preserved; never attach an old profile to a newly registered email automatically. Existing native users may log in with their native password. Clerk-only users need a new account or a separately reviewed identity migration.

Supabase default SMTP sends only to project-team addresses. Public password reset and confirmation mail require a configured mail provider; ordinary signup/login with the approved auto-confirm setting does not need an email delivery step. Do not claim public password recovery is ready until custom SMTP delivery has been tested. See https://supabase.com/docs/guides/auth/auth-smtp.

## Before deployment

1. Use the reviewed source branch. Run npm ci, npm run typecheck, npm run lint and the Vitest suite. The production build runs environment checks and rejects a diagnostic route in the built manifest. CI also replays tracked migrations and tests database authorization/concurrency.
2. Set five Vercel environment variables from .env.example: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL, SUPABASE_SERVICE_ROLE_KEY and AUCTION_TICK_SECRET. Use the real hosted Supabase project and the stable HTTPS Vercel origin. The tick secret must be random, at least 32 characters, and contain no whitespace. Never put service or tick secrets in NEXT_PUBLIC variables. DATABASE_URL is operator tooling only and is not required by the Vercel app.
3. Select Node 24 and the Next.js preset. vercel.json uses npm ci and npm run build. Local .env files, backups and diagnostics must not be uploaded. Build-time public variables require a rebuild after changing them.
4. Compare the hosted migration ledger with the canonical tracked migrations before applying anything. Take an approved backup of any existing real data. Use a dry run, inspect the pending list, then apply only reviewed pending migrations. Do not blindly replay old migrations against a populated hosted project. The new native Auth migration is supabase/migrations/20261102100000_native_auth_profiles.sql.
5. In Supabase Auth URL configuration, set Site URL to the stable Vercel origin and allow that origin /auth/callback (including the recovery next parameter) and /reset-password. Keep preview redirect URLs narrowly scoped. Disable the old Clerk third-party integration when switching the deployed app; local config already disables it. No email-based identity reassignment is part of this release.
6. Verify realtime publication contains auctions, auction_lots, bids, teams, squad_players, mini_auction_sessions and trades as required by the current subscriptions. Review the latest canonical publication migrations rather than resetting the publication. Confirm the intended public player set has actual player data; migrations alone do not prove the launch catalog is populated.

## Install the durable timer scheduler

Do this in the selected hosted Supabase project as the database owner; these files are operational SQL, not automatically applied schema migrations.

1. Enable pg_cron, pg_net and Supabase Vault through Supabase integrations/extensions. The project must support one-second cron schedules. Official docs: https://supabase.com/docs/guides/cron and https://supabase.com/docs/guides/functions/schedule-functions.
2. Run supabase/operations/auction-scheduler.sql. Installation starts disabled and cannot send requests. auction_private is not an exposed API schema; API roles have no privileges on it.
3. After deployment, POST /api/auction/tick without a secret must return 401; with the configured secret it must return 200 and success true. Use a private operator tool and do not print or paste the secret into logs. If Vercel deployment protection blocks machine access, configure the intended production endpoint appropriately; do not use a protected preview URL.
4. In Supabase Vault create exactly two named secrets: mega_auction_tick_url = https://YOUR-STABLE-VERCEL-ORIGIN/api/auction/tick, and mega_auction_tick_secret = the same AUCTION_TICK_SECRET stored in Vercel. Enter values through Vault/private tooling, not committed SQL.
5. Run supabase/operations/schedule-auction-tick.sql once. It installs the named tick and retention jobs. Then enable the scheduler with UPDATE auction_private.scheduler_state SET enabled=true, failures=0, request_id=NULL, next_attempt_at=now() WHERE singleton;
6. Inspect SELECT enabled,last_outcome,last_http_status,failures,requested_at FROM auction_private.scheduler_state; and cron job history. An idle room should generate no tick HTTP requests. A configuration_error requires correcting the endpoint/credentials and explicitly re-enabling. Temporary failures back off up to 30 seconds.
7. Confirm there is exactly one production timer driver. Disable legacy tick/backstop jobs targeting the same auctions and never run the local worker against the hosted production project. Do not remove unrelated jobs.

The Node API has a 10-second maximum duration and pg_net uses a matching HTTP timeout. The dispatcher waits up to 15 seconds before retrying an absent response. Database locks/idempotent RPCs remain the authority for bids and settlement. This controls duplicate requests but is not a guarantee against all network delays.

## Public smoke test before sharing

Use two separate browsers/devices and disposable native accounts. Create a room, join by code, start the auction, place competing bids and check the displayed amount on both devices. Let one player sell and one go unsold; verify the next player, purse, overseas count and squad exactly once. Test pause/resume, reload/reconnect, summary/stats, human trade proposal/accept/reject, mini selection expiry/release/bidding, and unauthorized host controls. Inspect scheduler and Realtime errors. Test phone/tablet layouts. Do not declare the launch verified from a successful build alone.

The isolated local SQL rehearsal covers native profile creation, duplicate usernames, admin isolation, UUID/RLS identity resolution, create/join/start, a real human bid, sold/unsold transitions, purse/squad updates, mini initiation, scheduler idle/due dispatch, serialization, retry/backoff and invalid-credential shutdown. Its HTTP/Vault surfaces are simulated and all fixtures roll back. It does not prove hosted pg_net/Vault integration, public email delivery, browser Realtime or multi-device trade/mini completion.

## Free-plan limits and recovery

Zero budget can support an initial personal friend launch within included allowances, not unlimited rooms or guaranteed uninterrupted uptime. Supabase free projects may pause after low activity and have database, connection, realtime and egress limits; Vercel Hobby has usage limits. Review dashboards before each event. Do not add a payment card or enable paid upgrades without explicit user authorization. See https://supabase.com/pricing, https://supabase.com/docs/guides/platform/free-project-pausing and https://vercel.com/docs/plans/hobby.

To stop timer dispatch: UPDATE auction_private.scheduler_state SET enabled=false WHERE singleton; then unschedule only mega-auction-tick if needed. Pause active rooms before maintenance. Auth deployment rollback also requires restoring the matching Auth provider configuration; changing the UI alone is insufficient. Never restore a stale database backup over completed real auctions as a routine application rollback.
