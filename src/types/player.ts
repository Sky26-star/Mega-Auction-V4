// src/types/player.ts
// 10/10+ Production-Quality Player Data Architecture for Mega Auction

export type PlayerAuctionStatus = 'UPCOMING' | 'LIVE' | 'SOLD' | 'UNSOLD';

export interface PlayerStats {
  matches?: number;
  runs?: number;
  average?: number;
  strikeRate?: number;
  hundreds?: number;
  fifties?: number;
  highest?: number | string;
  sixes?: number;
  wickets?: number;
  economy?: number;
  bestBowling?: string;
}

export interface PlayerData {
  id: string;
  lotNumber?: string;
  name: string;
  country: string;
  countryFlag?: string; // e.g. "🇬🇧", "🇮🇳", "🇦🇺", "🇿🇦", "🇳🇿", "🇼🇮", "🇦🇫"
  role: string; // e.g. "Wicket-Keeper • Batsman", "Fast Bowler", "All-Rounder"
  secondaryRole?: string;
  battingStyle?: string; // e.g. "Right-Handed Batsman"
  bowlingStyle?: string; // e.g. "Right-Arm Medium"
  age?: number;
  iplExperience?: string | boolean; // e.g. "107 Matches" / "Yes" / true
  isOverseas?: boolean;
  category?: string; // e.g. "MARQUEE", "ELITE", "CAPPED", "UNCAPPED"
  isStarPlayer?: boolean;
  teamCrestUrl?: string | null; // e.g. team badge/crest watermark
  basePriceCr: number; // In Crores (e.g., 2.0 = ₹2.00 Cr)
  imageUrl?: string | null;
  stats?: PlayerStats;
}

export interface TeamInfo {
  teamId?: string;
  teamName: string;
  teamCode?: string; // e.g. "CSK", "MI", "RCB", "KKR", "SRH", "RR", "GT", "DC"
  teamLogoUrl?: string | null;
  accentColor?: string; // e.g. "#YEL", "#PUR", "#BLU"
}

export interface RecentBid {
  id?: string;
  amountCr: number;
  teamCode: string;
  teamName: string;
  teamLogoUrl?: string | null;
  timeAgo?: string;
}

export interface PlayerCardProps {
  player: PlayerData;
  status: PlayerAuctionStatus;
  currentBidCr?: number | null;
  highestBidder?: TeamInfo | null;
  bidCount?: number;
  soldPriceCr?: number | null;
  winningTeam?: TeamInfo | null;
  timerSeconds?: number;
  maxTimerSeconds?: number;
  nextMinBidCr?: number | null;
  recentBids?: RecentBid[];
  onPlaceBid?: (amountCr: number) => void;
  isBiddingDisabled?: boolean;
  userTeamName?: string;
  className?: string;
}
