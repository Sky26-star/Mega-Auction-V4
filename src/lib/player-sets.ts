// src/lib/player-sets.ts
// Supabase Client Service Operations for Player Sets & Players (RLS Enforcement - V2)

import { createClient as createBrowserClient } from './supabase/client';
import type { PlayerSet, Player, PlayerSetFormInput, PlayerFormInput, PlayerSetCategoryCounts } from './types/player-set';

function formatPlayerPayload(p: PlayerFormInput, playerSetId?: string) {
  const is_overseas = p.country
    ? p.country.trim().toLowerCase() !== 'india'
    : Boolean(p.is_overseas);

  return {
    ...(playerSetId ? { player_set_id: playerSetId } : {}),
    name: p.name,
    country: p.country,
    role: p.role,
    category: p.category || 'C',
    base_price: p.base_price,
    is_overseas,
    image_url: p.image_url || null,
    age: p.age ?? null,
    batting_hand: p.batting_hand || null,

    // Batting stats
    matches: p.matches ?? null,
    runs: p.runs ?? null,
    batting_average: p.batting_average ?? null,
    strike_rate: p.strike_rate ?? null,
    hundreds: p.hundreds ?? null,
    fifties: p.fifties ?? null,
    highest_score: p.highest_score ?? null,
    boundaries: p.boundaries ?? null,

    // Bowling stats
    overs: p.overs ?? null,
    wickets: p.wickets ?? null,
    bowling_average: p.bowling_average ?? null,
    economy_rate: p.economy_rate ?? null,
    bowling_strike_rate: p.bowling_strike_rate ?? null,
    best_bowling: p.best_bowling || null,
    three_wicket_hauls: p.three_wicket_hauls ?? null,

    // Keeping stats
    catches: p.catches ?? null,
    stumpings: p.stumpings ?? null,
  };
}

function computeSetCategoryDistribution(rawPlayers: Array<{ category: string; image_url: string | null; name: string }>) {
  const count = rawPlayers.length;
  const category_counts: PlayerSetCategoryCounts = {
    MARQUEE: 0,
    A: 0,
    B: 0,
    C: 0,
    D: 0,
  };

  const preview_images: string[] = [];

  rawPlayers.forEach((p) => {
    if (p.category && category_counts[p.category as keyof PlayerSetCategoryCounts] !== undefined) {
      category_counts[p.category as keyof PlayerSetCategoryCounts]++;
    }
    if (p.image_url && preview_images.length < 4) {
      preview_images.push(p.image_url);
    }
  });

  return { count, category_counts, preview_images };
}

/**
 * Fetch all player sets accessible by the authenticated user.
 */
export async function getPlayerSets(): Promise<PlayerSet[]> {
  const supabase = createBrowserClient();

  const { data: playerSets, error } = await supabase
    .from('player_sets')
    .select(`
      *,
      players (category, image_url, name)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch player sets: ${error.message}`);
  }

  return (playerSets || []).map((ps: any) => {
    const rawPlayers = Array.isArray(ps.players) ? ps.players : [];
    const { count, category_counts, preview_images } = computeSetCategoryDistribution(rawPlayers);

    return {
      ...ps,
      player_count: count,
      category_counts,
      preview_images,
    };
  }) as PlayerSet[];
}

/**
 * Fetch a single player set by ID with actual player count & category counts.
 */
export async function getPlayerSetById(id: string): Promise<PlayerSet | null> {
  const supabase = createBrowserClient();

  const { data, error } = await supabase
    .from('player_sets')
    .select(`
      *,
      players (category, image_url, name)
    `)
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  const rawPlayers = Array.isArray(data.players) ? data.players : [];
  const { count, category_counts, preview_images } = computeSetCategoryDistribution(rawPlayers);

  return {
    ...data,
    player_count: count,
    category_counts,
    preview_images,
  } as PlayerSet;
}

/**
 * Create a new Player Set.
 */
export async function createPlayerSet(input: PlayerSetFormInput): Promise<PlayerSet> {
  const supabase = createBrowserClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    throw new Error('User must be authenticated to create a player set');
  }

  const { data, error } = await supabase
    .from('player_sets')
    .insert({
      name: input.name,
      description: input.description || null,
      is_public: input.is_public ?? false,
      created_by: user.user.id,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create player set: ${error.message}`);
  }

  return {
    ...data,
    player_count: 0,
    category_counts: { MARQUEE: 0, A: 0, B: 0, C: 0, D: 0 },
    preview_images: [],
  } as PlayerSet;
}

/**
 * Update an existing Player Set (Owner ONLY).
 */
export async function updatePlayerSet(id: string, input: PlayerSetFormInput): Promise<PlayerSet> {
  const supabase = createBrowserClient();

  const { data, error } = await supabase
    .from('player_sets')
    .update({
      name: input.name,
      description: input.description || null,
      is_public: input.is_public ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update player set: ${error.message}`);
  }

  return {
    ...data,
    player_count: 0,
    category_counts: { MARQUEE: 0, A: 0, B: 0, C: 0, D: 0 },
    preview_images: [],
  } as PlayerSet;
}

/**
 * Delete a Player Set (Owner ONLY).
 */
export async function deletePlayerSet(id: string): Promise<void> {
  const supabase = createBrowserClient();

  const { error } = await supabase
    .from('player_sets')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete player set: ${error.message}`);
  }
}

/**
 * Fetch all players belonging to a player set.
 */
export async function getPlayersBySetId(playerSetId: string): Promise<Player[]> {
  const supabase = createBrowserClient();

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('player_set_id', playerSetId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch players: ${error.message}`);
  }

  return (data || []) as Player[];
}

/**
 * Create a single player in a player set.
 */
export async function createPlayer(playerSetId: string, input: PlayerFormInput): Promise<Player> {
  const supabase = createBrowserClient();
  const payload = formatPlayerPayload(input, playerSetId);

  const { data, error } = await supabase
    .from('players')
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add player: ${error.message}`);
  }

  return data as Player;
}

/**
 * Update an existing player record.
 */
export async function updatePlayer(playerId: string, input: PlayerFormInput): Promise<Player> {
  const supabase = createBrowserClient();
  const payload = formatPlayerPayload(input);

  const { data, error } = await supabase
    .from('players')
    .update(payload)
    .eq('id', playerId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update player: ${error.message}`);
  }

  return data as Player;
}

/**
 * Delete a player from a player set.
 */
export async function deletePlayer(playerId: string): Promise<void> {
  const supabase = createBrowserClient();

  const { error } = await supabase
    .from('players')
    .delete()
    .eq('id', playerId);

  if (error) {
    throw new Error(`Failed to delete player: ${error.message}`);
  }
}

/**
 * Bulk insert players into a player set in batches of 100.
 */
export async function bulkInsertPlayers(playerSetId: string, playersInput: PlayerFormInput[]): Promise<number> {
  const supabase = createBrowserClient();
  const BATCH_SIZE = 100;
  let totalInserted = 0;

  for (let i = 0; i < playersInput.length; i += BATCH_SIZE) {
    const batch = playersInput
      .slice(i, i + BATCH_SIZE)
      .map((p) => formatPlayerPayload(p, playerSetId));

    const { data, error } = await supabase
      .from('players')
      .insert(batch)
      .select('id');

    if (error) {
      throw new Error(`Failed to import player batch starting at row ${i + 1}: ${error.message}`);
    }

    totalInserted += (data || []).length;
  }

  return totalInserted;
}
