// src/lib/types/room.ts
// Phase 5 Room & Team Management Types for Mega Auction V1

export type RoomStatus = 'OPEN' | 'LOBBY' | 'LOCKED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export type ParticipantRole = 'HOST' | 'MEMBER' | 'SPECTATOR';
export type AuctionStatus = 'LOBBY' | 'READY' | 'STARTING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

export interface RoomSettings {
  timer_duration_seconds: number;
  min_bid_increment: number;
  default_purse: number;
  max_squad_size: number;
  max_overseas: number;
  player_set_id: string | null;
  player_order: string;
  bot_count?: number;
  bots?: any[];
}

export interface Room {
  id: string;
  code: string;
  name: string;
  host_id: string;
  status: RoomStatus;
  settings: RoomSettings;
  created_at: string;
  updated_at: string;
  last_activity_at?: string;
  // Joined relations
  host_profile?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
  player_set_name?: string;
  participant_count?: number;
  auction_id?: string;
}

/** Minimal room fields returned by the authenticated invite-code preview RPC. */
export type RoomPreviewSettings = Pick<
  RoomSettings,
  'default_purse' | 'timer_duration_seconds' | 'max_squad_size' | 'max_overseas'
>;

export interface RoomPreview {
  id: string;
  code: string;
  name: string;
  host_id: string;
  status: RoomStatus;
  settings: RoomPreviewSettings;
  player_set_name: string | null;
  host_profile: NonNullable<Room['host_profile']> | null;
}

export interface RoomParticipant {
  id: string;
  room_id: string;
  user_id: string | null;
  team_id: string | null;
  role: ParticipantRole;
  is_bot: boolean;
  is_connected: boolean;
  last_seen_at: string;
  created_at: string;
  // Joined relations
  profile?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
  team?: Team;
}

export interface Team {
  id: string;
  auction_id: string;
  name: string;
  short_name: string;
  color: string;
  purse: number;
  initial_purse: number;
  players_bought: number;
  overseas_count: number;
  is_bot: boolean;
  created_at: string;
  assigned_participant?: RoomParticipant;
}

export interface CreateRoomInput {
  name: string;
  code: string;
  player_set_id: string;
  default_purse: number;
  timer_duration_seconds: number;
  min_bid_increment: number;
  max_squad_size: number;
  max_overseas: number;
  // Host team identity (Phase 5B)
  team_name: string;
  team_short_name: string;
  team_color: string;
  bot_count?: number;
  bot_difficulty?: string;
  player_pool?: string[]; // Array of UUIDs from the master dataset
  is_custom_code?: boolean;
}

export interface JoinRoomInput {
  team_name: string;
  team_short_name: string;
  team_color: string;
}

export interface UpdateTeamInput {
  team_name: string;
  team_short_name: string;
  team_color: string;
}

export interface TeamFormInput {
  name: string;
  short_name: string;
  color: string;
  initial_purse?: number;
  is_bot?: boolean;
  assigned_participant_id?: string | null;
}

