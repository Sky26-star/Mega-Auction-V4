// src/lib/trade/trade-types.ts
// Domain Types and Contracts for Player-to-Player Trade System

import type { V3Player, V3Team } from '../v3-auction-types';

export type TradeStatus =
  | 'PENDING'
  | 'COUNTERED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type TradeAction = 'ACCEPT' | 'REJECT' | 'CANCEL' | 'COUNTER';

export type FairnessGrade =
  | 'HIGHLY_FAVORABLE'
  | 'FAIR'
  | 'UNFAVORABLE'
  | 'HEAVILY_UNFAVORABLE';

export interface RoleImpactDetails {
  proposerGainsRole: string[];
  receiverGainsRole: string[];
  proposerDeficitFilled: boolean;
  receiverDeficitFilled: boolean;
}

export interface TradeFairnessResult {
  proposerGivenValue: number;
  proposerReceivedValue: number;
  receiverGivenValue: number;
  receiverReceivedValue: number;
  fairnessRatio: number; // >1 favors receiver; <1 favors proposer
  fairnessGrade: FairnessGrade;
  roleImpact: RoleImpactDetails;
  explanation: string;
  acceptanceLikelihood: number; // 0 to 100%
}

export interface TradeValidationResult {
  valid: boolean;
  error?: string;
  proposerNewSquadSize: number;
  receiverNewSquadSize: number;
  proposerNewOverseas: number;
  receiverNewOverseas: number;
}

export interface TradeRecord {
  id: string;
  auction_id: string;
  room_id: string;
  proposer_team_id: string;
  receiver_team_id: string;
  proposer_player_ids: string[];
  receiver_player_ids: string[];
  status: TradeStatus;
  parent_trade_id?: string | null;
  proposer_notes?: string | null;
  response_notes?: string | null;
  fair_value_score?: TradeFairnessResult | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  finalized_at?: string | null;

  // Joined metadata for UI presentation
  proposer_team?: V3Team;
  receiver_team?: V3Team;
  proposer_players?: V3Player[];
  receiver_players?: V3Player[];
}

export interface TradeProposalInput {
  receiverTeamId: string;
  proposerPlayerIds: string[];
  receiverPlayerIds: string[];
  notes?: string;
  parentTradeId?: string | null;
}
