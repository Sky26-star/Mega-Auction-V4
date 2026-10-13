// src/lib/v3-auction-types.ts
// Authoritative Data Contract for V3 Auction Engine

export type V3AuctionStatus = 'LOBBY' | 'READY' | 'STARTING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'MINI_AUCTION';
export type V3LotStatus = 'PENDING' | 'GET_READY' | 'ACTIVE' | 'BIDDING' | 'SOLD' | 'UNSOLD' | 'SKIPPED';
export type V3PlayerRole = 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER';
export type V3PlayerCategory = 'MARQUEE' | 'A' | 'B' | 'C' | 'D';

export interface V3Auction {
  id: string;
  room_id: string;
  status: V3AuctionStatus;
  current_lot_id: string | null;
  current_lot_index: number;
  paused_reason?: string | null;
  total_lots?: number;
  completed_at?: string | null;
  mega_completed_at?: string | null;
  started_at?: string | null;
  created_at?: string;
  is_unsold_round?: boolean;
}

export interface V3AuctionLot {
  id: string;
  auction_id: string;
  player_id: string;
  lot_index: number;
  status: V3LotStatus;
  base_price: number;
  current_bid: number;
  highest_bidder_team_id: string | null;
  winning_team_id: string | null;
  winning_bid: number | null;
  get_ready_expires_at: string | null;
  timer_expires_at: string | null;
  is_mini_round?: boolean;
}

export interface V3Player {
  id: string;
  name: string;
  role: V3PlayerRole;
  category: V3PlayerCategory;
  country: string;
  age: number | null;
  batting_hand: string | null;
  base_price: number;
  is_overseas: boolean;
  image_url: string | null;
  rating?: number | null;
  created_at?: string;

  // Batting Statistics (from players table — already fetched, now typed)
  matches?: number | null;
  runs?: number | null;
  batting_average?: number | null;
  strike_rate?: number | null;
  hundreds?: number | null;
  fifties?: number | null;
  highest_score?: number | null;
  boundaries?: number | null;

  // Bowling Statistics
  overs?: number | null;
  wickets?: number | null;
  bowling_average?: number | null;
  economy_rate?: number | null;
  bowling_strike_rate?: number | null;
  best_bowling?: string | null;
  three_wicket_hauls?: number | null;

  // Wicket-Keeping Statistics
  catches?: number | null;
  stumpings?: number | null;
}

export interface V3Team {
  id: string;
  name: string;
  short_name: string;
  purse: number;
  initial_purse: number;
  players_bought: number;
  overseas_count: number;
  is_bot: boolean;
}

export interface V3AuctionState {
  auction: V3Auction | null;
  currentLot: V3AuctionLot | null;
  currentPlayer: V3Player | null;
  teams: V3Team[];
  miniSession?: V3MiniAuctionSession | null;
}

export type MiniAuctionStatus = 'SETUP' | 'SELECTION_OPEN' | 'SELECTION_CLOSED' | 'BIDDING' | 'COMPLETED';

export interface V3MiniAuctionSession {
  id: string;
  auction_id: string;
  status: MiniAuctionStatus;
  selection_expires_at?: string | null;
  total_lots: number;
  closed_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface V3MiniSelection {
  id: string;
  auction_id: string;
  team_id: string;
  player_id: string;
  created_at: string;
}

export interface V3MiniTeamStatus {
  id: string;
  auction_id: string;
  team_id: string;
  has_confirmed: boolean;
  confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
}
