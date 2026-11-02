# Mega Auction V4

Authoritative, real-time multiplayer cricket auction draft platform with sub-second bid resolution, server-side bot intelligence, and zero split-brain lot state under concurrent bidding.

---

## 1. Core Architecture

- **Web Application:** Next.js 15 (React 18, Tailwind CSS, TypeScript).
- **Authoritative Database:** PostgreSQL 17 via Supabase Cloud with Row Level Security (RLS) and SECURITY DEFINER RPCs (`v3_place_bid`, `v3_finalize_and_advance_lot`, `v3_start_bidding`).
- **Realtime Layer:** Supabase Realtime WebSockets for sub-200ms bid and lot transitions.
- **Authentication:** Clerk Auth with server-side identity bridge (`public.resolve_user_id()`) mapping Clerk identities to internal profile records.
- **Autonomous Worker:** Background ticker process running singleton at 500ms cadence via Fly.io / Docker.

---

## 2. Quick Start & Local Development

### Prerequisites
- Node.js >= 20.x
- npm >= 10.x
- PostgreSQL 17 or Supabase CLI (optional for direct database integration testing)

### Installation
```bash
npm ci
```

### Environment Setup
Copy `.env.example` to `.env.local` and configure your credentials:
```bash
cp .env.example .env.local
```

### Running Locally
```bash
# Start Next.js and its background auction worker together
npm run dev
```

For a local Supabase URL, start Docker Desktop and the verified Supabase stack first.
`npm run dev` checks the local Auth health endpoint before starting Next.js, then waits
for the auction tick route before launching one worker. An unavailable local API
produces a startup error instead of repeated worker timeouts. This health check
confirms API availability; container identity, database volumes, and local-only port
bindings must be verified separately when setting up or repairing a stack.

`npm run worker` is for running the worker separately when the web server is already
running without a worker. Do not run it alongside `npm run dev`.

Development keeps up to four recently compiled pages available for five minutes.
The launcher starts the installed Next.js and worker programs directly, avoiding
extra Windows command-shell processes. Node source-map translation is disabled
for the development server; browser source maps and hot reload remain available.
First visits can still require compilation. Warm navigation and first-time
compilation are different measurements; neither is a guaranteed timing budget.

### Verification Scripts
```bash
npm run typecheck                  # Verify TypeScript types (0 errors)
npm run lint                       # Run ESLint audit
npm run test:run                   # Run Vitest test suite with threads pool
npm run check:no-diagnostic-route  # Verify diagnostic routes are absent
```

---

## 3. Database Migrations & Replay

All database schema definitions and RPCs are version-controlled in `supabase/migrations/`.

### Migration Ordering & Application
```bash
# Apply pending migrations to local or target PostgreSQL
for file in $(ls -1v supabase/migrations/*.sql); do
  echo "Applying $file..."
  psql "$DATABASE_URL" -f "$file"
done

# Reload PostgREST schema cache
psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema';"
```

---

## 4. Background Worker Deployment & Startup

The auction worker executes autonomous lot transitions, countdown timer expiration, and bot bid submissions.

### Deployment on Fly.io
Configuration is defined in `fly.toml`:
```bash
# 1. Provision required secrets in Fly vault
fly secrets set AUCTION_TICK_URL="https://your-domain.com/api/auction/tick" -a mega-auction-worker
fly secrets set AUCTION_TICK_SECRET="your_cryptographic_secret_min_32_chars" -a mega-auction-worker

# 2. Deploy worker container
fly deploy -a mega-auction-worker

# 3. Enforce singleton machine count
fly scale count 1 -a mega-auction-worker --yes
```

---

## 5. Backup, Restore, and Disaster Recovery

### Database Volume Snapshot & Export
```bash
# Capture full schema and data dump
pg_dump "$DATABASE_URL" --format=custom --file="backup_$(date +%Y%m%d_%H%M%S).dump"
```

### Database Restore Procedure
```bash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "backup_file.dump"
psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema';"
```

---

## 6. Production Rollback Plan

If an operational anomaly occurs during deployment:

1. **Scale down worker:**
   ```bash
   fly scale count 0 -a mega-auction-worker --yes
   ```
2. **Rollback web deployment:**
   Promote previous stable deployment in Vercel Dashboard or CLI (`vercel rollback`).
3. **Database rollback:**
   Apply pre-tested reverse scripts from `supabase/local-db-rollback/` or restore from volume snapshot.
4. **Restore worker:**
   ```bash
   fly scale count 1 -a mega-auction-worker --yes
   ```

For detailed incident response, stuck auction recovery, and telemetry metrics, refer to:
👉 [RELEASE_OPERATIONS_AND_INCIDENT_RUNBOOK.md](docs/RELEASE_OPERATIONS_AND_INCIDENT_RUNBOOK.md).

---

## 7. Admin and Test-Mode Security Controls

- **Admin Access:** Server-side verification (`verifyAdminUser` in `src/lib/admin/auth.ts`) validates `profiles.is_admin = true` through the server service client. Client flags are never trusted.
- **Diagnostic Route Gating:** `/api/diag` is strictly disabled (`route.ts.disabled`) and blocked from production builds.
- **Tick Route Security:** `/api/auction/tick` requires `x-auction-tick-secret` >= 32 characters compared with `timingSafeEqual`.
- **Environment Isolation:** Local Supabase URLs (`127.0.0.1`, `localhost`) are blocked in production via `src/lib/env.ts`.
