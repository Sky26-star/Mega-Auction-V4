-- Migration: 00003_indexes.sql
-- Description: Performance indexes for high-frequency query paths in Mega Auction V1

-- Rooms indexes
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_host ON public.rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms(status);

-- Room participants indexes
CREATE INDEX IF NOT EXISTS idx_room_participants_room_user ON public.room_participants(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_team ON public.room_participants(team_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_last_seen ON public.room_participants(last_seen_at);

-- Players indexes
CREATE INDEX IF NOT EXISTS idx_players_set ON public.players(player_set_id);
CREATE INDEX IF NOT EXISTS idx_players_role ON public.players(role);
CREATE INDEX IF NOT EXISTS idx_players_category ON public.players(category);

-- Auctions indexes
CREATE INDEX IF NOT EXISTS idx_auctions_room ON public.auctions(room_id);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON public.auctions(status);

-- Teams indexes
CREATE INDEX IF NOT EXISTS idx_teams_auction ON public.teams(auction_id);

-- Auction lots indexes
CREATE INDEX IF NOT EXISTS idx_auction_lots_auction ON public.auction_lots(auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_lots_status ON public.auction_lots(status);
CREATE INDEX IF NOT EXISTS idx_auction_lots_timer_expires ON public.auction_lots(timer_expires_at) WHERE status = 'BIDDING';

-- Squad players indexes
CREATE INDEX IF NOT EXISTS idx_squad_players_team ON public.squad_players(team_id);
CREATE INDEX IF NOT EXISTS idx_squad_players_auction ON public.squad_players(auction_id);

-- Bids indexes
CREATE INDEX IF NOT EXISTS idx_bids_lot ON public.bids(lot_id);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON public.bids(auction_id);
CREATE INDEX IF NOT EXISTS idx_bids_team ON public.bids(team_id);

-- Auction events indexes
CREATE INDEX IF NOT EXISTS idx_auction_events_seq ON public.auction_events(auction_id, sequence);

-- Bot lot state indexes
CREATE INDEX IF NOT EXISTS idx_bot_lot_state_eligible ON public.bot_lot_state(next_bid_eligible_at) WHERE is_interested = true AND has_bid_current_price = false;
