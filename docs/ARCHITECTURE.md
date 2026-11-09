# MEGA AUCTION V1 â€” SYSTEM ARCHITECTURE

> **Status:** APPROVED
> **Version:** 1.1
> **Date:** 2026-08-10

---

## 1. High-Level System Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                       CLIENT (Browser)                        â”‚
â”‚                                                              â”‚
â”‚  Next.js React UI â† Zustand Store â† Supabase Realtime WS    â”‚
â”‚       â”‚                                    â”‚                  â”‚
â”‚  Presentation-only       Selective         Auto-reconnect     â”‚
â”‚  timer countdown         subscriptions    + Sequence Gap Checkâ”‚
â”‚       â”‚                                    â”‚                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
        â”‚ Server Actions                     â”‚ WebSocket
        â”‚ (with request_id)                  â”‚ Subscription
        â”‚ POST /api/heartbeat                â”‚
        â–¼                                    â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                     SERVER (Vercel)                            â”‚
â”‚                                                              â”‚
â”‚  Server Actions â”€â”€â†’ Auth Check â”€â”€â†’ Zod Validation            â”‚
â”‚       â”‚                                                      â”‚
â”‚  Advisory Rule Engine (TypeScript, UX pre-validation)         â”‚
â”‚       â”‚                                                      â”‚
â”‚  Supabase RPC call â”€â”€â†’ process_bid(..., p_request_id)        â”‚
â”‚       â”‚                                                      â”‚
â”‚  Broadcast via Supabase Realtime REST API                     â”‚
â”‚  { sequence, event_type, payload }                           â”‚
â”‚       â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
        â”‚
        â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  SUPABASE (PostgreSQL)                         â”‚
â”‚                                                              â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚ 12 Tables  â”‚  â”‚ Database Functions   â”‚  â”‚ pg_cron       â”‚ â”‚
â”‚  â”‚ + RLS      â”‚  â”‚ (AUTHORITATIVE)      â”‚  â”‚               â”‚ â”‚
â”‚  â”‚ + Indexes  â”‚  â”‚                      â”‚  â”‚ Every 10s:    â”‚ â”‚
â”‚  â”‚ + Triggers â”‚  â”‚ process_bid()        â”‚  â”‚  expire lots  â”‚ â”‚
â”‚  â”‚            â”‚  â”‚ process_lot_expiry() â”‚  â”‚  execute bots â”‚ â”‚
â”‚  â”‚            â”‚  â”‚ purchase_player()    â”‚  â”‚               â”‚ â”‚
â”‚  â”‚            â”‚  â”‚ start_auction()      â”‚  â”‚ Every 6h:     â”‚ â”‚
â”‚  â”‚            â”‚  â”‚ advance_lot()        â”‚  â”‚  keep-alive   â”‚ â”‚
â”‚  â”‚            â”‚  â”‚ pause/resume()       â”‚  â”‚               â”‚ â”‚
â”‚  â”‚            â”‚  â”‚ evaluate_bots()      â”‚  â”‚ Daily:        â”‚ â”‚
â”‚  â”‚            â”‚  â”‚ execute_bot_bids()   â”‚  â”‚  clean logs   â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                              â”‚
â”‚  Authority: clock_timestamp() >= timer_expires_at            â”‚
â”‚  Concurrency: SELECT FOR UPDATE + pg_try_advisory_xact_lock  â”‚
â”‚  Idempotency: UNIQUE(request_id) on bids table               â”‚
â”‚  Sequence: Atomic increment on auctions.current_sequence     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 2. Key Architectural Tenets
1. **PostgreSQL Absolute Authority:** All state transitions, validations, and mutations occur inside database functions (`process_bid()`, `process_lot_expiry()`, etc.).
2. **Clock Timestamp Consistency:** `clock_timestamp()` is used exclusively for all business timing decisions (expiry, staleness, bot delays).
3. **Idempotent Mutations:** Every bid requires a client `request_id` enforced via `bids.request_id UNIQUE`.
4. **Sequence-Numbered Realtime:** Events carry authoritative `sequence` integers enabling client gap detection and full-state recovery.
5. **Heartbeat-Driven Bots:** Server-side bots execute via heartbeats and pg_cron backstop using the identical `process_bid()` pipeline.
