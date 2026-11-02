# MEGA AUCTION V1 â€” TESTING STRATEGY & TEST SUITE DOCUMENTATION

> **Status:** IN PROGRESS
> **Version:** 1.0
> **Date:** 2026-08-10

---

## 1. Testing Framework Stack
- **Unit & Domain Testing:** Vitest
- **Component Testing:** React Testing Library + Vitest
- **Database Integration Testing:** Vitest against Supabase local environment
- **End-to-End Testing:** Playwright

---

## 2. Test Suite Architecture

### 2.1 Unit Tests (`src/test/unit/`)
- Advisory Rule Engine validation checks
- Auction State Machine transitions
- Mandatory Reserve & Max Bid calculations
- Zod schema validators
- Timer remaining time utilities

### 2.2 Integration Tests (`src/test/integration/`)
- RPC execution: `process_bid()`, `process_lot_expiry()`, `purchase_player()`
- Advisory lock rate limiting
- Idempotency via duplicate `request_id` submission
- Database team ownership verification
- RLS policy access controls

### 2.3 Concurrency Tests (`src/test/concurrency/`)
- 5 concurrent bids submitted for the same lot
- Simultaneous bid vs expiry race conditions
- Duplicate `request_id` concurrent retries

### 2.4 E2E Tests (`src/test/e2e/`)
- Full user journey: Signup -> Create Room -> Add Player Set -> Configure -> Start Auction -> Bid -> Complete
- Multi-tab bidding synchronization
- Disconnect & state recovery verification
