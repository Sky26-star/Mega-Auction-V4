# Mega Auction V4 â€” Release Operations, Rollback, Monitoring & Incident Runbook

**Document Version:** 1.0.0
**Target Release:** Mega-Auction V4
**Date:** 2026-10-29
**Classification:** Production Engineering & SRE Operations

---

## 1. Production Platform & Secret Variables Checklist

All platform variables must be provisioned in their respective production secret vaults (Vercel Project Settings, Fly.io Secrets, Supabase Dashboard).

| Variable Name | Environment / Service | Public / Secret | Requirement & Verification Rule |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next.js (Client + Server) | **Public** | Must begin with `pk_live_`. Never use `pk_test_` in production. |
| `CLERK_SECRET_KEY` | Next.js (Server only) | **Secret** | Must begin with `sk_live_`. Never expose to client bundles or commit to Git. |
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js (Client + Server) | **Public** | Must resolve to production Supabase domain (e.g., `https://[project-id].supabase.co`). Never `localhost` or `127.0.0.1` (enforced by `src/lib/env.ts`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js (Client + Server) | **Public** | Production anon JWT token for Supabase client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js (Server only) | **Secret** | Production service-role JWT for backend admin operations. Stripped from client bundle by `src/lib/env.ts`. |
| `DATABASE_URL` | Next.js & Supabase CLI | **Secret** | Direct connection pooler string (port 6543 / 5432) pointing to production PostgreSQL instance. |
| `AUCTION_TICK_URL` | Fly.io Worker | **Secret / Config** | HTTPS URL of the Next.js production endpoint: `https://[app-domain]/api/auction/tick`. |
| `AUCTION_TICK_SECRET` | Next.js Server & Fly Worker | **Secret** | Cryptographically random string (>= 32 characters, no whitespace). Validated via `timingSafeEqual` in `src/lib/auction/tick-auth.ts`. |
| `NEXT_PUBLIC_APP_URL` | Next.js | **Public** | Canonical HTTPS domain for OAuth redirect callbacks and web share links. |

---

## 2. Production Rollback Plan

In the event of a critical failure during or immediately following deployment, execute the following phased rollback procedure.

### Phase 1: Background Worker Isolation
If ticks are failing or deadlocking:
```bash
# 1. Immediately scale down worker to prevent state progression
fly scale count 0 -a mega-auction-worker --yes

# 2. Inspect active machine logs
fly logs -a mega-auction-worker -n 100
```

### Phase 2: Web Application Rollback
If application code or frontend rendering fails:
1. In Vercel Dashboard: Navigate to **Deployments** -> Locate previous stable production deployment -> Click **Redeploy** or **Promote to Production**.
2. Alternatively via CLI:
   ```bash
   vercel rollback [deployment-id-or-url]
   ```

### Phase 3: Database Schema & Data Rollback
If a migration causes runtime errors:
1. Identify the failing migration from the `supabase_migrations.schema_migrations` table:
   ```sql
   SELECT version, inserted_at FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;
   ```
2. Apply the pre-tested reverse migration script from `supabase/local-db-rollback/` or restore from the automated pre-deployment backup volume snapshot.
3. Reload PostgREST schema cache:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

### Phase 4: Worker Restoration
Once web and database layers are restored:
```bash
fly scale count 1 -a mega-auction-worker --yes
fly status -a mega-auction-worker
```

---

## 3. Post-Deployment Smoke Test Protocol

Immediately after deployment to staging or production, execute these smoke checks:

1. **System Health Endpoint:**
   ```bash
   curl -i https://[app-domain]/api/health
   # Expected: HTTP 200 { "status": "ok", "timestamp": ... }
   ```
2. **Diagnostic Route Absence Verification:**
   ```bash
   curl -i https://[app-domain]/api/diag
   # Expected: HTTP 404 Not Found (enforced by verify-no-diagnostic-route)
   ```
3. **Tick Authentication Verification:**
   ```bash
   # Unauthenticated tick request
   curl -X POST https://[app-domain]/api/auction/tick
   # Expected: HTTP 401 Unauthorized

   # Authenticated tick request
   curl -X POST https://[app-domain]/api/auction/tick \
     -H "x-auction-tick-secret: [PROD_SECRET]"
   # Expected: HTTP 200 { "success": true, ... }
   ```
4. **Live Auction Lifecycle Smoke Test:**
   - Create private test room with 6-character code.
   - Start auction with 2 human participants and 2 bot teams.
   - Place bids sequentially: verify bid ladder increments (25L, 50L, 75L, etc.).
   - Allow countdown to expire: verify SOLD animation displays on both clients within 200ms.
   - Verify purse deductions in team matrix and squad assignment in roster.

---

## 4. Auction Stuck Detection and Recovery Runbook

### Symptoms of a Stuck Auction
- Lot countdown reaches 00:00 but does not advance to `SOLD` or `UNSOLD`.
- Bidding buttons remain disabled or say "AUCTION PAUSED" indefinitely.
- Room status says `IN_PROGRESS` but no current lot is active.

### Diagnostic SQL Queries
Run in Supabase SQL Editor:
```sql
-- 1. Check current auction status and pointers
SELECT a.id, a.room_id, a.status, a.current_lot_id, a.current_lot_index,
       al.status AS lot_status, al.timer_expires_at, al.highest_bidder_team_id, al.current_bid
  FROM public.auctions a
  LEFT JOIN public.auction_lots al ON al.id = a.current_lot_id
 WHERE a.status IN ('IN_PROGRESS', 'PAUSED', 'MINI_AUCTION');

-- 2. Check for active transaction locks
SELECT pid, age(clock_timestamp(), query_start), usename, query, state
  FROM pg_stat_activity
 WHERE query ILIKE '%v3_finalize_and_advance_lot%'
    OR query ILIKE '%v3_place_bid%'
 ORDER BY query_start ASC;

-- 3. Check orphaned lots
SELECT id, auction_id, lot_index, status, timer_expires_at
  FROM public.auction_lots
 WHERE status = 'BIDDING'
   AND timer_expires_at < clock_timestamp() - INTERVAL '30 seconds';
```

### Recovery Procedures

#### Case A: Lot Expired but Worker Skipped Finalization
Execute authoritative lot finalization via service-role SQL:
```sql
-- Replace with actual auction_id and lot_id from diagnostic query
SELECT public.v3_finalize_and_advance_lot(
  '00000000-0000-0000-0000-000000000000'::uuid, -- p_auction_id
  '11111111-1111-1111-1111-111111111111'::uuid, -- p_lot_id
  true                                           -- p_force: true bypasses timer check
);
```

#### Case B: Pointer Desynchronization (`current_lot_id` is NULL)
```sql
-- Reset auction lot pointer to next pending lot
WITH next_pending AS (
  SELECT id, lot_index
    FROM public.auction_lots
   WHERE auction_id = '00000000-0000-0000-0000-000000000000'::uuid
     AND status = 'PENDING'
   ORDER BY lot_index ASC
   LIMIT 1
)
UPDATE public.auctions
   SET current_lot_id = next_pending.id,
       current_lot_index = next_pending.lot_index,
       status = 'IN_PROGRESS'
  FROM next_pending
 WHERE public.auctions.id = '00000000-0000-0000-0000-000000000000'::uuid;

-- Set the lot to GET_READY with a 5-second countdown
UPDATE public.auction_lots
   SET status = 'GET_READY',
       get_ready_expires_at = clock_timestamp() + INTERVAL '5 seconds'
 WHERE id = (SELECT current_lot_id FROM public.auctions WHERE id = '00000000-0000-0000-0000-000000000000'::uuid);
```

#### Case C: Auction Stuck in PAUSED State
```sql
SELECT public.resume_auction('00000000-0000-0000-0000-000000000000'::uuid);
```

---

## 5. Monitoring, Latency, and Alerting Metrics

### Key Observability Metrics

| Metric | Target SLA | Critical Threshold | Alert Action |
|---|---|---|---|
| **Worker Tick Cadence** | 500ms Â± 100ms | > 2000ms gap | PagerDuty: Worker process stalled or restarted |
| **Tick Success Rate** | 100% | < 98% in 5m | Sentry alert: Check DB connection pool or RPC exceptions |
| **Bid Processing Latency (RPC)** | < 150ms (p95) | > 500ms (p95) | Warning: Investigate DB load and locking contention |
| **Realtime Broadcast Latency** | < 200ms | > 1000ms | Check Supabase Realtime channel saturation |
| **Deadlock Occurrences (`40P01`)** | 0 per day | >= 1 | Critical SRE: Lock order inversion detected |
| **Active Postgres Connections** | < 60% of pool | > 85% of pool | Auto-kill idle connections and check connection leaks |

### Monitoring Dashboard Queries

```sql
-- 1. Failed bids in the last 1 hour
SELECT error, count(*) AS failure_count
  FROM public.audit_logs
 WHERE action = 'BID_REJECTED'
   AND created_at > clock_timestamp() - INTERVAL '1 hour'
 GROUP BY error
 ORDER BY failure_count DESC;

-- 2. Average lot duration and bid velocity
SELECT a.id AS auction_id,
       count(b.id) AS total_bids,
       avg(b.amount) AS avg_bid_amount,
       max(b.created_at) - min(b.created_at) AS active_duration
  FROM public.auctions a
  JOIN public.bids b ON b.auction_id = a.id
 WHERE a.created_at > clock_timestamp() - INTERVAL '24 hours'
 GROUP BY a.id;
```
