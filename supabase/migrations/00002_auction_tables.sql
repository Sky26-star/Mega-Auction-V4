-- Migration: 00002_auction_tables.sql
-- Description: Auction session entity tables for Mega Auction V1 (Auctions, Teams, Lots, Squad Players, Bids, Events, Bot State)

-- 1. AUCTIONS
CREATE TABLE IF NOT EXISTS public.auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL UNIQUE REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_set_id UUID NOT NULL REFERENCES public.player_sets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY','READY','STARTING','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED')),
  current_lot_id UUID, -- FK added after auction_lots
  current_lot_index INT NOT NULL DEFAULT 0,
  total_lots INT NOT NULL DEFAULT 0,
  current_sequence INT NOT NULL DEFAULT 0,
  is_unsold_round BOOLEAN NOT NULL DEFAULT false,
  paused_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paused_reason TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TEAMS
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name VARCHAR(5) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#000000',
  purse INT NOT NULL CHECK (purse >= 0),
  initial_purse INT NOT NULL CHECK (initial_purse >= 0),
  players_bought INT NOT NULL DEFAULT 0 CHECK (players_bought >= 0),
  overseas_count INT NOT NULL DEFAULT 0 CHECK (overseas_count >= 0),
  is_bot BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_auction_team_name UNIQUE(auction_id, name)
);

-- Add deferred FK to room_participants now that teams exists
ALTER TABLE public.room_participants 
  ADD CONSTRAINT fk_room_participants_team 
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

-- 3. AUCTION LOTS
CREATE TABLE IF NOT EXISTS public.auction_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  lot_index INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','BIDDING','SOLD','UNSOLD','SKIPPED')),
  base_price INT NOT NULL CHECK (base_price >= 1),
  current_bid INT NOT NULL DEFAULT 0,
  highest_bidder_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  winning_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  winning_bid INT,
  timer_duration_seconds INT NOT NULL DEFAULT 15,
  timer_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_auction_lot_index UNIQUE(auction_id, lot_index)
);

-- Add deferred FK to auctions.current_lot_id
ALTER TABLE public.auctions 
  ADD CONSTRAINT fk_auctions_current_lot 
  FOREIGN KEY (current_lot_id) REFERENCES public.auction_lots(id) ON DELETE SET NULL;

-- 4. SQUAD PLAYERS
CREATE TABLE IF NOT EXISTS public.squad_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES public.auction_lots(id) ON DELETE CASCADE,
  purchase_price INT NOT NULL CHECK (purchase_price >= 1),
  bought_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_auction_player UNIQUE(auction_id, player_id)
);

-- 5. BIDS
CREATE TABLE IF NOT EXISTS public.bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES public.auction_lots(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  amount INT NOT NULL CHECK (amount >= 1),
  request_id UUID NOT NULL UNIQUE,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  rejection_reason TEXT,
  bid_number INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. AUCTION EVENTS
CREATE TABLE IF NOT EXISTS public.auction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  sequence INT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_auction_sequence UNIQUE(auction_id, sequence)
);

-- 7. BOT LOT STATE
CREATE TABLE IF NOT EXISTS public.bot_lot_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES public.auction_lots(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  is_interested BOOLEAN NOT NULL DEFAULT true,
  max_per_player_budget INT NOT NULL,
  has_bid_current_price BOOLEAN NOT NULL DEFAULT false,
  next_bid_eligible_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_bot_lot_team UNIQUE(lot_id, team_id)
);
