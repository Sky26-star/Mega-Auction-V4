# MEGA AUCTION V1 â€” DATABASE SPECIFICATION

> **Status:** IMPLEMENTED (Phase 2A)
> **Target Database Engine:** PostgreSQL 15+ (Supabase Managed PostgreSQL)
> **ORM / Query Strategy:** Supabase JavaScript Client (`@supabase/supabase-js`) + PostgreSQL Stored Functions (RPCs) for transactional operations. Zero Prisma ORM.

---

## 1. SCHEMA OVERVIEW

Mega Auction V1 uses a normalized relational database schema with 12 core tables:

```
auth.users (Supabase Auth)
  â””â”€â”€ public.profiles (User identity & global permissions)
       â”œâ”€â”€ public.rooms (Host rooms)
       â”‚    â”œâ”€â”€ public.room_participants (User & bot room presence)
       â”‚    â””â”€â”€ public.auctions (1-to-1 Room auction sessions)
       â”‚         â”œâ”€â”€ public.teams (Bidding teams & budget tracking)
       â”‚         â”œâ”€â”€ public.auction_lots (Ordered player bidding lots)
       â”‚         â”‚    â”œâ”€â”€ public.squad_players (Purchased roster)
       â”‚         â”‚    â”œâ”€â”€ public.bids (Audit trail & idempotency log)
       â”‚         â”‚    â””â”€â”€ public.bot_lot_state (Bot evaluation cache)
       â”‚         â””â”€â”€ public.auction_events (Authoritative sequence event store)
       â””â”€â”€ public.player_sets (Player pool collections)
            â””â”€â”€ public.players (Master player records)
```

---

## 2. TABLE SCHEMAS & MIGRATION MAPPING

### Migration Files
1. `supabase/migrations/00001_core_tables.sql` â€” Profiles, Rooms, Player Sets, Players, Room Participants
2. `supabase/migrations/00002_auction_tables.sql` â€” Auctions, Teams, Auction Lots, Squad Players, Bids, Auction Events, Bot Lot State
3. `supabase/migrations/00003_indexes.sql` â€” Performance query indexes
4. `supabase/migrations/00004_triggers.sql` â€” Automated user profile creation & updated_at timestamp triggers
5. `supabase/migrations/00005_rls_policies.sql` â€” Row Level Security (RLS) policies

---

## 3. CORE ENTITIES (Migration `00001_core_tables.sql`)

### `public.profiles`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, REFERENCES `auth.users(id)` ON DELETE CASCADE | User identity identifier |
| `username` | TEXT | UNIQUE, NOT NULL | Public handle |
| `display_name` | TEXT | NOT NULL | UI display name |
| `avatar_url` | TEXT | NULLABLE | Profile image |
| `is_admin` | BOOLEAN | NOT NULL DEFAULT false | Platform administrator flag |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Registration timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last update timestamp |

### `public.rooms`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Room identifier |
| `code` | VARCHAR(6) | UNIQUE, NOT NULL | Room join code |
| `name` | TEXT | NOT NULL | Room title |
| `host_id` | UUID | NOT NULL REFERENCES `profiles(id)` ON DELETE CASCADE | Room creator |
| `status` | TEXT | NOT NULL DEFAULT 'OPEN' CHECK (`status` IN ('OPEN', 'LOCKED', 'COMPLETED', 'CANCELLED')) | Room state |
| `settings` | JSONB | NOT NULL DEFAULT `{...}` | Auction room configuration rules |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last update timestamp |

### `public.player_sets`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Player set identifier |
| `name` | TEXT | NOT NULL | Collection name |
| `description` | TEXT | NULLABLE | Collection details |
| `created_by` | UUID | NOT NULL REFERENCES `profiles(id)` ON DELETE CASCADE | Set author |
| `is_public` | BOOLEAN | NOT NULL DEFAULT false | Global visibility |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last update timestamp |

### `public.players`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Player identifier |
| `player_set_id` | UUID | NOT NULL REFERENCES `player_sets(id)` ON DELETE CASCADE | Parent collection |
| `name` | TEXT | NOT NULL | Full name |
| `role` | TEXT | NOT NULL CHECK (`role` IN ('BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER')) | Cricket role |
| `category` | TEXT | NOT NULL DEFAULT 'C' CHECK (`category` IN ('MARQUEE', 'A', 'B', 'C', 'D')) | Lot tier |
| `base_price` | INT | NOT NULL CHECK (`base_price` >= 1) | Reserve price |
| `is_overseas` | BOOLEAN | NOT NULL DEFAULT false | Overseas status |
| `image_url` | TEXT | NULLABLE | Player photo |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation timestamp |

### `public.room_participants`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Participant identifier |
| `room_id` | UUID | NOT NULL REFERENCES `rooms(id)` ON DELETE CASCADE | Target room |
| `user_id` | UUID | NULLABLE REFERENCES `profiles(id)` ON DELETE CASCADE | User account (NULL for bots) |
| `team_id` | UUID | NULLABLE REFERENCES `teams(id)` ON DELETE SET NULL | Assigned team |
| `role` | TEXT | NOT NULL DEFAULT 'MEMBER' CHECK (`role` IN ('HOST', 'MEMBER', 'SPECTATOR')) | Room privilege |
| `is_bot` | BOOLEAN | NOT NULL DEFAULT false | Bot participant flag |
| `is_connected` | BOOLEAN | NOT NULL DEFAULT true | Online status |
| `last_seen_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Heartbeat timestamp |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Join timestamp |
| UNIQUE | | `(room_id, user_id)` | One membership per user per room |

---

## 4. AUCTION SESSION ENTITIES (Migration `00002_auction_tables.sql`)

### `public.auctions`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Auction identifier |
| `room_id` | UUID | NOT NULL UNIQUE REFERENCES `rooms(id)` ON DELETE CASCADE | 1-to-1 room link |
| `player_set_id` | UUID | NOT NULL REFERENCES `player_sets(id)` ON DELETE RESTRICT | Active player set |
| `status` | TEXT | NOT NULL DEFAULT 'LOBBY' CHECK (`status` IN ('LOBBY','READY','STARTING','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED')) | Auction status |
| `current_lot_id` | UUID | NULLABLE REFERENCES `auction_lots(id)` ON DELETE SET NULL | Active bidding lot |
| `current_lot_index` | INT | NOT NULL DEFAULT 0 | Active lot index |
| `total_lots` | INT | NOT NULL DEFAULT 0 | Total lot count |
| `current_sequence` | INT | NOT NULL DEFAULT 0 | Authoritative realtime event sequence |
| `is_unsold_round` | BOOLEAN | NOT NULL DEFAULT false | Unsold player round flag |
| `paused_by` | UUID | NULLABLE REFERENCES `profiles(id)` ON DELETE SET NULL | User who paused |
| `paused_reason` | TEXT | NULLABLE | Pause explanation |
| `started_at` | TIMESTAMPTZ | NULLABLE | Auction start timestamp |
| `completed_at` | TIMESTAMPTZ | NULLABLE | Auction end timestamp |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation timestamp |

### `public.teams`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Team identifier |
| `auction_id` | UUID | NOT NULL REFERENCES `auctions(id)` ON DELETE CASCADE | Target auction |
| `name` | TEXT | NOT NULL | Team name |
| `short_name` | VARCHAR(5) | NOT NULL | Short code |
| `color` | VARCHAR(7) | NOT NULL DEFAULT '#000000' | Brand color |
| `purse` | INT | NOT NULL CHECK (`purse` >= 0) | Remaining budget |
| `initial_purse` | INT | NOT NULL CHECK (`initial_purse` >= 0) | Starting budget |
| `players_bought` | INT | NOT NULL DEFAULT 0 CHECK (`players_bought` >= 0) | Roster size |
| `overseas_count` | INT | NOT NULL DEFAULT 0 CHECK (`overseas_count` >= 0) | Overseas count |
| `is_bot` | BOOLEAN | NOT NULL DEFAULT false | Bot team flag |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation timestamp |
| UNIQUE | | `(auction_id, name)` | Unique team name per auction |

### `public.auction_lots`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Lot identifier |
| `auction_id` | UUID | NOT NULL REFERENCES `auctions(id)` ON DELETE CASCADE | Target auction |
| `player_id` | UUID | NOT NULL REFERENCES `players(id)` ON DELETE RESTRICT | Target player |
| `lot_index` | INT | NOT NULL | Order in sequence |
| `status` | TEXT | NOT NULL DEFAULT 'PENDING' CHECK (`status` IN ('PENDING','ACTIVE','BIDDING','SOLD','UNSOLD','SKIPPED')) | Lot state |
| `base_price` | INT | NOT NULL CHECK (`base_price` >= 1) | Reserve price |
| `current_bid` | INT | NOT NULL DEFAULT 0 | High bid |
| `highest_bidder_team_id` | UUID | NULLABLE REFERENCES `teams(id)` ON DELETE SET NULL | Current high bidder |
| `winning_team_id` | UUID | NULLABLE REFERENCES `teams(id)` ON DELETE SET NULL | Winner |
| `winning_bid` | INT | NULLABLE | Final price |
| `timer_duration_seconds` | INT | NOT NULL DEFAULT 15 | Countdown window |
| `timer_expires_at` | TIMESTAMPTZ | NULLABLE | Authoritative expiry timestamp |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation timestamp |
| UNIQUE | | `(auction_id, lot_index)` | Unique index per auction |

### `public.squad_players`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Roster entry identifier |
| `auction_id` | UUID | NOT NULL REFERENCES `auctions(id)` ON DELETE CASCADE | Target auction |
| `team_id` | UUID | NOT NULL REFERENCES `teams(id)` ON DELETE CASCADE | Purchasing team |
| `player_id` | UUID | NOT NULL REFERENCES `players(id)` ON DELETE RESTRICT | Acquired player |
| `lot_id` | UUID | NOT NULL REFERENCES `auction_lots(id)` ON DELETE CASCADE | Source lot |
| `purchase_price` | INT | NOT NULL CHECK (`purchase_price` >= 1) | Sale price |
| `bought_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Purchase timestamp |
| UNIQUE | | `(auction_id, player_id)` | One squad placement per player |

### `public.bids` (Bid Idempotency Schema)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Bid identifier |
| `auction_id` | UUID | NOT NULL REFERENCES `auctions(id)` ON DELETE CASCADE | Target auction |
| `lot_id` | UUID | NOT NULL REFERENCES `auction_lots(id)` ON DELETE CASCADE | Target lot |
| `team_id` | UUID | NOT NULL REFERENCES `teams(id)` ON DELETE CASCADE | Bidding team |
| `amount` | INT | NOT NULL CHECK (`amount` >= 1) | Bid price |
| `request_id` | UUID | NOT NULL UNIQUE | Client idempotency request ID |
| `is_bot` | BOOLEAN | NOT NULL DEFAULT false | Bot submission flag |
| `is_valid` | BOOLEAN | NOT NULL DEFAULT true | Validity flag |
| `rejection_reason` | TEXT | NULLABLE | Rejection cause |
| `bid_number` | INT | NOT NULL | Sequential bid count |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Submission timestamp |

### `public.auction_events` (Realtime Event Store)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Event record identifier |
| `auction_id` | UUID | NOT NULL REFERENCES `auctions(id)` ON DELETE CASCADE | Target auction |
| `sequence` | INT | NOT NULL | Monotonic sequence number |
| `event_type` | TEXT | NOT NULL | Event classification string |
| `payload` | JSONB | NOT NULL DEFAULT `{}` | Event data payload |
| `actor_id` | UUID | NULLABLE REFERENCES `profiles(id)` ON DELETE SET NULL | Triggering user |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Generation timestamp |
| UNIQUE | | `(auction_id, sequence)` | Strict monotonic sequence ordering |

### `public.bot_lot_state`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY DEFAULT `gen_random_uuid()` | Bot state identifier |
| `lot_id` | UUID | NOT NULL REFERENCES `auction_lots(id)` ON DELETE CASCADE | Target lot |
| `team_id` | UUID | NOT NULL REFERENCES `teams(id)` ON DELETE CASCADE | Bot team |
| `is_interested` | BOOLEAN | NOT NULL DEFAULT true | Bidding interest flag |
| `max_per_player_budget` | INT | NOT NULL | Evaluated ceiling |
| `has_bid_current_price` | BOOLEAN | NOT NULL DEFAULT false | Current price bid flag |
| `next_bid_eligible_at` | TIMESTAMPTZ | NULLABLE | Earliest bot retry timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | State update timestamp |
| UNIQUE | | `(lot_id, team_id)` | One state record per bot team per lot |

---

## 5. ROW LEVEL SECURITY (RLS) POLICIES (Migration `00005_rls_policies.sql`)

All 12 tables have `ENABLE ROW LEVEL SECURITY` enforced with explicit access control policies:

1. `profiles`: Viewable by everyone; updatable only by owning user (`auth.uid() = id`).
2. `rooms`: Viewable by authenticated users; insertable by host (`auth.uid() = host_id`); updatable by host.
3. `room_participants`: Viewable by room members/host; insertable/updatable by host or joining user.
4. `player_sets`: Viewable if public or created by user; editable/deletable by author.
5. `players`: Viewable via accessible player set; editable by player set author.
6. `auctions`: Viewable by room participants; insertable/updatable by host.
7. `teams`: Viewable by room participants.
8. `auction_lots`: Viewable by room participants.
9. `squad_players`: Viewable by room participants.
10. `bids`: Viewable by room participants.
11. `auction_events`: Viewable by room participants.
12. `bot_lot_state`: Viewable by room participants. Direct user update blocked (managed by DB functions).

---

## 6. DEFINITION OF DONE (Phase 2A)

- All 12 tables defined and migrated.
- Idempotency (`bids.request_id` UNIQUE) enforced.
- Realtime ordering (`auction_events.sequence` UNIQUE) enforced.
- Participant heartbeats (`room_participants.last_seen_at`) enforced.
- RLS enabled on all 12 tables.
- Zero Phase 2B RPC functions created.
- All schema unit tests passed 100%.
