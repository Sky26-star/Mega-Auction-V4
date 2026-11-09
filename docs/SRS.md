# MEGA AUCTION V1 â€” SOFTWARE REQUIREMENTS SPECIFICATION (SRS)

> **Status:** APPROVED
> **Version:** 1.0
> **Date:** 2026-08-10

---

## 1. System Inputs & Outputs

### 1.1 Inputs
- User Authentication credentials (email/password)
- Room creation parameter inputs (name, timer duration, purse, min increment, player set)
- Bid submissions (`auction_id`, `amount`, `request_id`)
- Client heartbeats (POST `/api/heartbeat`)
- Player management CSV files

### 1.2 Outputs
- Realtime broadcast events (`auction:bid_placed`, `auction:lot_started`, `auction:lot_completed`, etc.)
- Session tokens & HTTP cookies
- Aggregated room statistics & exported CSV summaries

---

## 2. Business Rules & Logic

### 2.1 Rule 1 â€” Bid Authorization & Team Ownership
- `process_bid()` verifies `auth.uid()` -> `room_participants` -> `team_id` -> `is_bot = false`.
- Cross-team bidding or unassigned spectating bids are rejected immediately.

### 2.2 Rule 2 â€” Bid Increment & Ceiling
- Minimum bid = `current_bid + min_bid_increment` (or `base_price` for first bid).
- Maximum bid = `purse - mandatory_reserve`.

### 2.3 Rule 3 â€” Mandatory Reserve Calculation
```
remaining_slots = max_squad_size - players_bought - 1
min_base_price = MIN(base_price) among remaining lots
mandatory_reserve = remaining_slots * min_base_price
max_bid = purse - mandatory_reserve
```

### 2.4 Rule 4 â€” Overseas Player Ceiling
- If `player.is_overseas = true` AND `team.overseas_count >= max_overseas`, bid is rejected with `BID_OVERSEAS_LIMIT`.

### 2.5 Rule 5 â€” Squad Size Limit
- If `team.players_bought >= max_squad_size`, bid is rejected with `BID_SQUAD_FULL`.

### 2.6 Rule 6 â€” Timer Reset & Expiry
- Valid bid resets `timer_expires_at = clock_timestamp() + timer_duration_seconds`.
- Expiry condition: `clock_timestamp() >= timer_expires_at`.
- Unsold player 2nd round: 50% base price reduction.

---

## 3. Performance & Quality Attributes
- **Concurrency:** `SELECT FOR UPDATE` serializes bids per lot.
- **Idempotency:** `request_id` UNIQUE constraint on `bids` table prevents duplicate processing.
- **Sequence Authority:** `auctions.current_sequence` & `auction_events.sequence` ensure gap detection and state recovery.
