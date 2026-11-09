# Mega Auction V4

Multiplayer cricket auctions with Supabase Realtime, franchise squads, trades and mini auctions.

## Architecture

- Next.js 15, React 18, TypeScript and Tailwind on Vercel Hobby.
- Supabase PostgreSQL 17 with authenticated RPCs and row-level security.
- Native Supabase Google/GitHub authentication; Auth UUIDs are profile IDs.
- Supabase Cron, pg_net and Vault drive persisted auction deadlines. Production HTTP ticks run only when work is due; no Fly account or separate paid worker is required.
- Human rooms are enabled. Bot opponents remain deferred and disabled.

See [the deployment guide](docs/DEPLOYMENT.md) for the complete zero-budget launch procedure, Auth choices, scheduler installation, verification and free-plan limits. The code preparation does not itself activate hosted services.

## Local development

Use Node 24 and npm. Install with `npm ci`, copy `.env.example` to `.env.local`, and fill in your local Supabase URL and keys. Set the local application URL to `http://localhost:3000`.

Start Docker Desktop and the verified local Supabase stack, then run `npm run dev`. The launcher checks local Auth availability, starts Next.js and waits for the authenticated tick route before starting one local worker. Do not run another worker alongside it. Keep local worker settings pointed at a disposable local project.

First visits in development can require compilation. Production builds compile pages before serving; cold function/network delays and warm navigation are separate measurements.

## Checks

```sh
npm run typecheck
npm run lint
npm run test:run -- --maxWorkers=2
npm run check:production
npm run build
```

`npm run build` requires hosted production environment values and verifies that `/api/diag` is absent. Do not weaken the production check to build against localhost. CI uses nonworking placeholder hosted credentials for compilation and a separate disposable PostgreSQL service for database checks.

## Database and timer setup

Canonical schema migrations live in `supabase/migrations/`. Compare the target migration ledger, inspect a dry run and apply reviewed pending migrations. Do not replay every historical migration against a populated production project.

The native profile trigger migration creates unprivileged profiles by Auth UUID, handles duplicate usernames, preserves historical profiles and never merges accounts by email. Existing Clerk-only identities require separate review if their old room ownership must be transferred.

Hosted scheduler installation is separate from schema migration:

1. Enable Supabase Cron, pg_net and Vault.
2. Install `supabase/operations/auction-scheduler.sql` (disabled initially).
3. Deploy and verify the protected tick endpoint.
4. Store the stable tick URL and matching secret in Vault.
5. Install `supabase/operations/schedule-auction-tick.sql`, enable the scheduler and verify a two-device auction.

Exact steps, monitoring queries and rollback instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Security and launch limits

The server verifies native Auth identities. Administrative checks read the protected `is_admin` field through a server-only client. Browser callers cannot change identity or admin fields. Tick requests require a private shared secret. Local credential files, database backups and diagnostic routes are excluded from deployment artifacts.

The active authentication UI offers Google and GitHub only. Provider credentials, callback URLs and backend provider settings still require the setup in [SOCIAL_AUTH_SETUP.md](docs/SOCIAL_AUTH_SETUP.md). Password login/signup/recovery controls are retired. Existing account continuity and Supabase-managed identity linking must be verified before launch.

Zero-budget plans have usage limits and possible service pauses. Test public login, realtime reconnection, bids, settlement, trades and mini auctions after deployment before sharing the site. Do not enable a paid plan without explicit authorization.
