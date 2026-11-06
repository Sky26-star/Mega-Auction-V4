# MEGA AUCTION V1 — CHANGELOG

All notable changes to the Mega Auction V1 project will be documented in this file.

---

## [Unreleased]

---

## [0.2.0] - 2026-08-11

### Added — Phase 2A (Database Schema & RLS Policies)
- Added `supabase/migrations/00001_core_tables.sql` defining `profiles`, `rooms`, `player_sets`, `players`, and `room_participants` tables.
- Added `supabase/migrations/00002_auction_tables.sql` defining `auctions`, `teams`, `auction_lots`, `squad_players`, `bids`, `auction_events`, and `bot_lot_state` tables.
- Added `supabase/migrations/00003_indexes.sql` defining 22 performance indexes for room lookups, participant presence, bid history, event sequences, and bot states.
- Added `supabase/migrations/00004_triggers.sql` defining automatic `handle_new_user()` profile generation and `set_updated_at()` maintenance triggers.
- Added `supabase/migrations/00005_rls_policies.sql` enforcing Row Level Security (RLS) policies on all 12 tables with explicit room and user isolation rules.
- Implemented `public.is_room_participant(UUID, UUID)` `SECURITY DEFINER` helper function with `STABLE` volatility and hardened privileges to resolve PostgreSQL `ERROR 42P17` infinite recursion on `room_participants`.
- Added `src/test/database/schema.test.ts` testing schema integrity, constraints, idempotency structure, sequence structure, RLS activation, and RPC isolation.
- Added `src/test/database/rls.runtime.test.ts` testing live runtime database RLS policies against real remote Supabase instance (8/8 PASS).
- Applied RLS correction migration to remote Supabase development instance (`https://zkrxuowctprncwnymnvg.supabase.co`).
- Created `docs/PHASE_2A_REPORT.md` documenting Phase 2A database schema and RLS implementation (STATUS: APPROVED).

---

## [0.1.0] - 2026-08-10

### Added — Phase 1 (Architecture & Project Foundation)
- Initialized Next.js 15 App Router project structure with strict TypeScript mode.
- Configured Tailwind CSS design tokens and PostCSS.
- Initialized shadcn/ui component configuration and utility helpers.
- Added `@supabase/supabase-js` and `@supabase/ssr` client infrastructure wrappers.
- Configured Zod environment validation and domain error utilities.
- Added Zustand state management dependencies, constants, and domain types.
- Configured Vitest runner with JSDOM and Playwright E2E runner.
- Added Playwright baseline smoke test suite (`src/test/e2e/smoke.spec.ts`).
- Created 11 living documentation files in `docs/`.
- Created `docs/PHASE_1_REPORT.md`.
