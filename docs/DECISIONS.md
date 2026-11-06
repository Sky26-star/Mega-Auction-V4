# MEGA AUCTION V1 â€” ARCHITECTURAL & PRODUCT DECISIONS LOG

> **Status:** APPROVED
> **Version:** 1.1
> **Date:** 2026-08-10

---

## 1. Approved Architecture Decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| ARCH-001 | Auth Provider | Supabase Auth (replacing Clerk) | Native RLS/Realtime integration, zero user-sync webhooks, single database |
| ARCH-002 | Data Access | Supabase Client + PostgreSQL RPCs (replacing Prisma) | Critical paths require `SELECT FOR UPDATE` & database transactions |
| ARCH-003 | Time Function | `clock_timestamp()` for all business decisions | `NOW()` is frozen at transaction start; `clock_timestamp()` provides wall-clock time after lock acquisition |
| ARCH-004 | Bot Execution | Heartbeat-driven DB-persisted state | `setTimeout` is terminated on serverless instances |
| ARCH-005 | Rate Limiting | Database-level advisory locks (`pg_try_advisory_xact_lock`) | Serverless instances do not share in-memory state |
| ARCH-006 | Rule Engine | TS = Advisory (UX), DB = Authoritative | Pre-validation for UI responsiveness; single source of truth in PostgreSQL |
| ARCH-007 | Realtime Broadcast | Supabase Realtime REST API | Stateless HTTP POST avoids serverless WebSocket connection overhead |
| ARCH-008 | Event Sequence | Atomic per-auction sequence (`auctions.current_sequence`) | Enables client gap detection and automatic full-state recovery |
| ARCH-009 | Idempotency | Client-generated `request_id` stored with UNIQUE constraint | Prevents duplicate processing on network retries |

---

## 2. Approved Product Decisions

| ID | Feature | Decision |
|---|---|---|
| DEC-001 | Player Order | Host-configurable (CATEGORY default with marquee first, RANDOM, BASE_PRICE_DESC, BASE_PRICE_ASC) |
| DEC-002 | Bid Increment | Host-configurable fixed increment (default 5, range 1â€“100) |
| DEC-003 | Timer Duration | Host-configurable (default 15s, range 10â€“60s) |
| DEC-004 | Mandatory Reserve | YES â€” teams must retain purse for remaining squad slots |
| DEC-005 | Unsold Players | Unsold pool receives a 2nd round pass at 50% reduced base price |
| DEC-006 | Room Scope | One auction per room |
| DEC-007 | Player Images | Deferred image source decision to Phase 4 |
| DEC-008 | Purse Units | Host-configurable (default 1000 abstract units) |
