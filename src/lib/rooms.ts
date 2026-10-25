// src/lib/rooms.ts
// Supabase Client Operations for Room & Team Management (Phase 5B — RPC & RLS Enforced)

import { createClient } from './supabase/client';
import { getCurrentProfile } from './auth';
import { getUniqueBotIdentities } from './bots';
import { normalizePurseToLakhs } from '@/lib/auction/units';
import type {
  Room,
  RoomPreview,
  RoomParticipant,
  Team,
  CreateRoomInput,
  JoinRoomInput,
  UpdateTeamInput,
} from './types/room';

export const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Helper to map RPC error messages to user-friendly text.
 */
export function formatRpcError(message: string): string {
  if (!message) return 'An unexpected error occurred.';
  if (message.includes('AUTH_REQUIRED')) return 'You must be logged in to perform this action.';
  if (message.includes('ROOM_NOT_FOUND')) return 'Room with this code was not found. Please check the code and try again.';
  if (message.includes('ROOM_NOT_OPEN')) return 'This room is no longer open for joining.';
  if (message.includes('NOT_IN_LOBBY')) return 'The auction session has already started or completed.';
  if (message.includes('INVALID_ROOM_NAME')) return 'Room name must be between 3 and 50 characters.';
  if (message.includes('INVALID_TEAM_NAME')) return 'Team name must be between 2 and 30 characters.';
  if (message.includes('INVALID_SHORT_NAME')) return 'Short name must be between 2 and 5 characters.';
  if (message.includes('INVALID_COLOR')) return 'Please choose a valid 6-digit hex color (e.g. #FF5733).';
  if (message.includes('INVALID_PURSE')) return 'Default purse must be at least 100 Lakhs/Cr.';
  if (message.includes('DUPLICATE_SHORT_NAME') || message.includes('unique_auction_team_short_name')) return 'A team with this short code already exists in this auction room. Please choose a different code.';
  if (message.includes('unique_auction_team_name')) return 'A team with this name already exists in this auction room. Please choose a different name.';
  if (message.includes('rooms_code_key')) return 'A room with this code already exists. Please choose a different code.';
  if (message.includes('PLAYER_SET_UNAUTHORIZED')) return 'You do not have permission to use the selected player set.';
  if (message.includes('PLAYER_SET_NOT_FOUND')) return 'Selected player set was not found.';
  if (message.includes('NOT_TEAM_OWNER')) return 'You do not own this team.';
  if (message.includes('AUCTION_NOT_LOBBY')) return 'Team identity cannot be changed after the auction starts.';
  if (message.includes('NOT_HOST')) return 'Only the room host can modify room settings or start the auction.';
  if (message.includes('ROOM_STATUS_IMMUTABLE')) return 'Room settings cannot be modified once the auction has started.';
  if (message.includes('INVALID_TIMER_DURATION')) return 'Timer duration must be between 5 and 60 seconds per lot.';
  if (message.includes('INVALID_SQUAD_SIZE')) return 'Maximum squad size must be between 15 and 30 players.';
  if (message.includes('AUCTION_ACTIVE')) return 'Participant removal is only allowed while the auction is in LOBBY state.';
  if (message.includes('CANNOT_REMOVE_HOST')) return 'The host cannot be removed from the room.';
  if (message.includes('UNAUTHORIZED_NOT_HOST')) return 'Only the room host can provision bot opponents.';
  if (message.includes('INVALID_BOT_COUNT')) return 'Bot count must be between 0 and 9.';
  if (message.includes('EXCEEDS_MANAGER_CAPACITY')) return 'Total room managers cannot exceed 10.';
  if (message.includes('UNAUTHORIZED')) return 'You are not authorized to perform this action.';
  return message;
}

export const MAX_ROOM_CODE_RETRIES = 5;

async function attachHostProfiles<T extends { host_id: string }>(
  supabase: ReturnType<typeof createClient>,
  rooms: Array<T & { id: string }>
): Promise<Array<T & { host_profile: Room['host_profile'] | null }>> {
  if (rooms.length === 0) return [];

  const { data, error } = await supabase
    .rpc('get_room_public_profiles', { p_room_ids: [...new Set(rooms.map(room => room.id))] });
  if (error) throw new Error(error.message);

  const profiles = new Map<string, NonNullable<Room['host_profile']>>(
    ((data || []) as Array<NonNullable<Room['host_profile']> & { room_id: string }>).map(profile => [
      `${profile.room_id}:${profile.id}`,
      profile,
    ])
  );
  return rooms.map(room => ({
    ...room,
    host_profile: profiles.get(`${room.id}:${room.host_id}`) || null,
  }));
}

/**
 * Checks if an error represents a PostgreSQL unique constraint violation specifically for rooms.code (rooms_code_key).
 */
export function isRoomCodeCollisionError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return error.includes('rooms_code_key') || (error.includes('23505') && error.includes('code'));
  }
  if (typeof error === 'object') {
    const err = error as Record<string, unknown>;
    const message = typeof err.message === 'string' ? err.message : '';
    const details = typeof err.details === 'string' ? err.details : '';
    const hint = typeof err.hint === 'string' ? err.hint : '';
    const code = typeof err.code === 'string' ? err.code : '';

    if (
      message.includes('rooms_code_key') ||
      details.includes('rooms_code_key') ||
      hint.includes('rooms_code_key')
    ) {
      return true;
    }

    if (code === '23505' && (message.includes('code') || details.includes('code') || message.includes('rooms'))) {
      return true;
    }
  }
  return false;
}

/**
 * Generates a random 6-character uppercase alphanumeric code.
 */
export function generateRandomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[idx];
  }
  return code;
}

/**
 * Generates a unique 6-character room code with bounded retry collisions.
 */
export async function generateUniqueRoomCode(
  maxAttempts = MAX_ROOM_CODE_RETRIES,
  supabaseClient?: any
): Promise<string> {
  const supabase = supabaseClient || createClient();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidateCode = generateRandomCode();
    const { data, error } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', candidateCode)
      .maybeSingle();

    if (!error && !data) {
      return candidateCode;
    }
  }

  throw new Error('Failed to generate a unique room code. Please try again.');
}

/**
 * Fetches all rooms accessible by the current authenticated user.
 */
export async function getRooms(): Promise<Room[]> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('User must be logged in');

  const supabase = createClient();

  const { data: participantData, error: partError } = await supabase
    .from('room_participants')
    .select('room_id')
    .eq('user_id', profile.id);

  if (partError) throw new Error(partError.message);

  const roomIds = (participantData || []).map((p: { room_id: string }) => p.room_id);

  let query = supabase.from('rooms').select(`
    *,
    auctions(id, player_set_id, player_sets(name))
  `).order('created_at', { ascending: false });

  if (roomIds.length > 0) {
    query = query.or(`host_id.eq.${profile.id},id.in.(${roomIds.join(',')})`);
  } else {
    query = query.eq('host_id', profile.id);
  }

  const { data: roomRows, error } = await query;
  if (error) throw new Error(error.message);

  const roomsWithHosts = await attachHostProfiles(supabase, (roomRows || []) as any[]);
  return roomsWithHosts.map((r: any) => {
    const auction = Array.isArray(r.auctions) ? r.auctions[0] : (r.auctions || null);
    const playerSet = auction?.player_sets ? (Array.isArray(auction.player_sets) ? auction.player_sets[0] : auction.player_sets) : null;
    return {
      ...r,
      player_set_name: playerSet?.name ?? 'Default Pool',
      auction_id: auction?.id,
    };
  });
}

/**
 * Fetches single Room by ID along with host info and auction ID.
 */
export async function getRoomById(roomId: string): Promise<Room | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('rooms')
    .select(`
      *,
      auctions(id, player_set_id, player_sets(name))
    `)
    .eq('id', roomId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(error.message);
  }

  const [roomWithHost] = await attachHostProfiles(supabase, [data as any]);

  const auction = Array.isArray(data.auctions) ? data.auctions[0] : (data.auctions || null);
  const playerSet = auction?.player_sets ? (Array.isArray(auction.player_sets) ? auction.player_sets[0] : auction.player_sets) : null;

  return {
    ...roomWithHost,
    player_set_name: playerSet?.name ?? 'Default Pool',
    auction_id: auction?.id,
  };
}

/**
 * Looks up room details by 6-character code for Room Preview step (read-only).
 */
export async function lookupRoomByCode(code: string): Promise<RoomPreview> {
  const supabase = createClient();
  const cleanCode = code.trim().toUpperCase();

  const { data, error } = await supabase
    .rpc('get_room_preview_by_code', { p_code: cleanCode })
    .maybeSingle();

  if (error || !data) {
    throw new Error('ROOM_NOT_FOUND: Room code is invalid or the room is no longer open for joining.');
  }

  const preview = data as unknown as {
    room_id: string;
    code: string;
    name: string;
    host_id: string;
    status: RoomPreview['status'];
    settings: RoomPreview['settings'];
    player_set_name: string | null;
    host_profile_id: string | null;
    host_username: string | null;
    host_display_name: string | null;
    host_avatar_url: string | null;
  };

  return {
    id: preview.room_id,
    code: preview.code,
    name: preview.name,
    host_id: preview.host_id,
    status: preview.status,
    settings: preview.settings,
    player_set_name: preview.player_set_name,
    host_profile: preview.host_profile_id
      ? {
          id: preview.host_profile_id,
          username: preview.host_username || '',
          display_name: preview.host_display_name || '',
          avatar_url: preview.host_avatar_url,
        }
      : null,
  };
}

/**
 * Creates a new Room + Host Participant + Auction + Host Team in a single atomic transaction.
 * Also provisions selected bot opponents via trusted SECURITY DEFINER RPC provision_room_bots().
 * Retries with a newly generated code if an insert encounters a rooms_code_key uniqueness collision.
 */
export async function createRoom(
  input: CreateRoomInput,
  maxRetries = MAX_ROOM_CODE_RETRIES
): Promise<Room> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('User must be logged in to create a room');

  const supabase = createClient();

  // 1. Determine Bot Opponents Selection (Min 0, Max 9)
  const requestedBotCount = Math.min(9, Math.max(0, input.bot_count ?? 0));
  const selectedBots = getUniqueBotIdentities(requestedBotCount, [input.team_name]);

  const botPayload = selectedBots.map((b) => ({
    id: b.id,
    name: b.name,
    shortName: b.shortName,
    color: b.color,
    managerName: b.managerName,
  }));

  let finalPlayerSetId = input.player_set_id;
  if (finalPlayerSetId === 'DEFAULT') {
    finalPlayerSetId = '00000000-0000-0000-0000-000000000202';
  }

  const roomSettings = {
    timer_duration_seconds: input.timer_duration_seconds,
    min_bid_increment: input.min_bid_increment,
    default_purse: input.default_purse,
    max_squad_size: input.max_squad_size,
    max_overseas: input.max_overseas,
    player_set_id: finalPlayerSetId,
    player_order: 'CATEGORY',
    bot_count: requestedBotCount,
    bots: botPayload,
    bot_difficulty: input.bot_difficulty,
  };

  let candidateCode = input.code;
  let rpcData: any = null;
  let lastCollisionError: any = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 2. Call RPC create_room_with_team()
    const { data, error } = await supabase.rpc('create_room_with_team', {
      p_room_code: candidateCode,
      p_room_name: input.name,
      p_room_settings: roomSettings,
      p_player_set_id: finalPlayerSetId,
      p_team_name: input.team_name,
      p_team_short_name: input.team_short_name.toUpperCase(),
      p_team_color: input.team_color,
      p_default_purse: normalizePurseToLakhs(input.default_purse),
      p_player_ids: input.player_pool?.length ? input.player_pool : null
    });

    if (error) {
      if (isRoomCodeCollisionError(error)) {
        lastCollisionError = error;

        // If the user explicitly provided a custom code and it collided,
        // do not silently replace it with a random code; inform them.
        if (input.is_custom_code) {
          throw new Error('A room with this code already exists. Please choose a different code.');
        }

        // Bounded retry with a freshly generated candidate code
        candidateCode = generateRandomCode();
        continue;
      }

      // Requirement 6: Retry only the room-code uniqueness collision.
      // Do not retry authentication, permission, validation, or unrelated database errors.
      throw new Error(formatRpcError(error.message));
    }

    rpcData = data;
    break;
  }

  if (!rpcData) {
    throw new Error(
      lastCollisionError
        ? `Failed to generate a unique room code after ${maxRetries} attempts. Please try again.`
        : 'Failed to create room.'
    );
  }

  const roomId = rpcData.room_id;

  // 3. Atomically Provision Bot Opponents via trusted SECURITY DEFINER RPC
  if (requestedBotCount > 0 && selectedBots.length > 0) {
    const { error: botRpcError } = await supabase.rpc('provision_room_bots', {
      p_room_id: roomId,
      p_bots: botPayload,
    });

    if (botRpcError) {
      // Rollback created room if RPC fails
      await supabase.from('rooms').delete().eq('id', roomId);
      if (botRpcError.code === 'PGRST202' || botRpcError.message?.includes('schema cache')) {
        throw new Error('THE RPC MIGRATION MUST BE APPLIED TO THE CONNECTED SUPABASE DATABASE.');
      }
      throw new Error(formatRpcError(botRpcError.message));
    }
  }

  const finalRoom = await getRoomById(roomId);
  if (!finalRoom) {
    throw new Error('Room created successfully, but failed to fetch final room details.');
  }

  return finalRoom;
}

/**
 * Joins an existing room and creates participant's team in a single atomic transaction.
 * Calls RPC join_room_with_team().
 */
export async function joinRoomWithTeam(
  roomCode: string,
  teamInput: JoinRoomInput
): Promise<{ room_id: string; already_joined: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('User must be logged in to join a room');

  const supabase = createClient();

  const { data, error } = await supabase.rpc('join_room_with_team', {
    p_room_code: roomCode.trim().toUpperCase(),
    p_team_name: teamInput.team_name,
    p_team_short_name: teamInput.team_short_name.toUpperCase(),
    p_team_color: teamInput.team_color,
  });

  if (error) {
    throw new Error(formatRpcError(error.message));
  }

  return {
    room_id: data.room_id,
    already_joined: data.already_joined ?? false,
  };
}

/**
 * Legacy wrapper for joinRoomByCode — maps to lookupRoomByCode for backward compatibility.
 */
export async function joinRoomByCode(code: string): Promise<RoomPreview> {
  return lookupRoomByCode(code);
}

/**
 * Updates a participant's own team identity (Name, Short Code, Color) via RPC update_my_team().
 */
export async function updateMyTeam(teamId: string, input: UpdateTeamInput): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.rpc('update_my_team', {
    p_team_id: teamId,
    p_team_name: input.team_name,
    p_team_short_name: input.team_short_name.toUpperCase(),
    p_team_color: input.team_color,
  });

  if (error) {
    throw new Error(formatRpcError(error.message));
  }
}

/**
 * Removes a participant and their team from a room via RPC remove_room_participant().
 * Callable by self (leave room) or room host (moderation).
 */
export async function removeRoomParticipant(participantId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.rpc('remove_room_participant', {
    p_participant_id: participantId,
  });

  if (error) {
    throw new Error(formatRpcError(error.message));
  }
}

/**
 * Fetches all participants for a room with profiles and assigned team info.
 */
export async function getRoomParticipants(roomId: string): Promise<RoomParticipant[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('room_participants')
    .select(`
      *,
      team:teams(id, name, short_name, color)
    `)
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  const participants = (data || []) as any[];
  const { data: profiles, error: profilesError } = participants.length
    ? await supabase
        .rpc('get_room_public_profiles', { p_room_ids: [roomId] })
    : { data: [], error: null };
  if (profilesError) throw new Error(profilesError.message);

  const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
  return participants.map(participant => ({
    ...participant,
    profile: participant.user_id ? profileMap.get(participant.user_id) || null : null,
  })) as RoomParticipant[];
}

/**
 * Fetches current active auction row by room_id (since rooms table has no auction_id column).
 */
export async function getAuctionByRoomId(roomId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('auctions')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Fetches all teams for an auction by auctionId.
 */
export async function getAuctionTeams(auctionId: string): Promise<Team[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('auction_id', auctionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as Team[];
}

/**
 * Fetches all teams for a room's active auction using auctions.room_id -> rooms.id.
 */
export async function getAuctionTeamsByRoomId(roomId: string): Promise<Team[]> {
  const auction = await getAuctionByRoomId(roomId);
  if (!auction) return [];
  return getAuctionTeams(auction.id);
}

export interface UpdateRoomInput {
  name: string;
  default_purse: number;
  timer_duration_seconds: number;
  max_squad_size: number;
  bot_count?: number;
}

/**
 * Updates room configuration (Room Name, Purse, Timer, Squad, Bot Count) for host-owned open rooms.
 */
export async function updateRoom(roomId: string, input: UpdateRoomInput): Promise<Room> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('User must be logged in to update a room');

  const trimmedName = input.name.trim();
  if (trimmedName.length < 3 || trimmedName.length > 50) {
    throw new Error('Room name must be between 3 and 50 characters.');
  }

  const supabase = createClient();
  const existingRoom = await getRoomById(roomId);
  if (!existingRoom) throw new Error('Room not found.');
  if (existingRoom.host_id !== profile.id) throw new Error('Only the room host can edit room settings.');
  if (existingRoom.status !== 'OPEN') throw new Error('Cannot edit settings after auction has started.');

  const newBotCount = Math.min(9, Math.max(0, input.bot_count ?? existingRoom.settings?.bot_count ?? 0));
  let updatedBots = (existingRoom.settings?.bots as any[]) || [];

  if (newBotCount !== (existingRoom.settings?.bot_count ?? 0) || updatedBots.length !== newBotCount) {
    const hostTeamName = existingRoom.host_profile?.display_name || 'Host Franchise';
    const newBotsSelection = getUniqueBotIdentities(newBotCount, [hostTeamName]);
    updatedBots = newBotsSelection.map((b) => ({
      id: b.id,
      name: b.name,
      shortName: b.shortName,
      color: b.color,
      managerName: b.managerName,
    }));
  }

  const newSettings = {
    ...(existingRoom.settings || {}),
    default_purse: input.default_purse,
    timer_duration_seconds: input.timer_duration_seconds,
    max_squad_size: input.max_squad_size,
    bot_count: newBotCount,
    bots: updatedBots,
  };

  // 1. Attempt atomic update_room_settings RPC
  const { error: rpcError } = await supabase.rpc('update_room_settings', {
    p_room_id: roomId,
    p_room_name: trimmedName,
    p_room_settings: newSettings,
    p_default_purse: input.default_purse,
    p_timer_duration_seconds: input.timer_duration_seconds,
    p_max_squad_size: input.max_squad_size,
    p_bots: updatedBots,
  });

  if (rpcError) {
    console.warn('update_room_settings RPC fallback triggered:', rpcError.message);
    const { error: tableError } = await supabase
      .from('rooms')
      .update({
        name: trimmedName,
        settings: newSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', roomId)
      .eq('host_id', profile.id);

    if (tableError) throw new Error(formatRpcError(tableError.message));

    if (existingRoom.auction_id) {
      const purseLakhs = normalizePurseToLakhs(input.default_purse);
      await supabase
        .from('teams')
        .update({ purse: purseLakhs, initial_purse: purseLakhs })
        .eq('auction_id', existingRoom.auction_id);

      await supabase
        .from('auction_lots')
        .update({ timer_duration_seconds: input.timer_duration_seconds })
        .eq('auction_id', existingRoom.auction_id)
        .eq('status', 'PENDING');
    }

    const { error: botRpcErr } = await supabase.rpc('provision_room_bots', {
      p_room_id: roomId,
      p_bots: updatedBots,
    });
    if (botRpcErr) {
      console.warn('Bot re-provisioning fallback failed:', botRpcErr.message);
    }
  }

  const updated = await getRoomById(roomId);
  if (!updated) throw new Error('Failed to fetch updated room details.');
  return updated;
}

/**
 * Permanently deletes a room owned by current host.
 * Triggers SQL ON DELETE CASCADE for associated auctions, teams, and participants.
 */
export async function deleteRoom(roomId: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('User must be logged in to delete a room');

  const supabase = createClient();
  const existingRoom = await getRoomById(roomId);
  if (!existingRoom) throw new Error('Room not found.');
  if (existingRoom.host_id !== profile.id) throw new Error('Only the room host can delete this room.');

  // 1. Try trusted delete_room RPC
  const { error: rpcError } = await supabase.rpc('delete_room', { p_room_id: roomId });
  if (!rpcError) return;

  // 2. Fallback to direct DELETE query on rooms table
  const { error: tableError } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId)
    .eq('host_id', profile.id);

  if (tableError) {
    throw new Error(formatRpcError(tableError.message));
  }
}
