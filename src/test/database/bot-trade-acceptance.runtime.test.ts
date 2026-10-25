import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { formatIsolatedTarget, resolveIsolatedRlsConfig } from './runtime-test-config';

const isolatedConfig = resolveIsolatedRlsConfig(process.env);
const databaseTestsConfigured = isolatedConfig !== null;

const projectId = 'mega-auction-v4-phase2c-pg17-20261017';
const expectedDbContainer = `supabase_db_${projectId}`;
const expectedApiContainer = `supabase_kong_${projectId}`;
const expectedDbVolume = `supabase_db_${projectId}`;
const originalV4Volume = 'supabase_db_zkrxuowctprncwnymnvg';
const createdAuthUserIds: string[] = [];

function requireIsolatedConfig() {
  if (!isolatedConfig) throw new Error('Explicit isolated Supabase test configuration is required.');
  return isolatedConfig;
}

function inspectDisposableContainer(name: string, hostPort: string, containerPort: string) {
  const template = '{{.Name}}|{{.Config.Image}}|{{json .NetworkSettings.Ports}}|{{range .Mounts}}{{.Name}}:{{.Destination}};{{end}}';
  const inspected = spawnSync('docker', ['inspect', '--format', template, name], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });

  if (inspected.error || inspected.status !== 0 || !inspected.stdout.trim()) {
    throw new Error(`Disposable target preflight could not inspect ${name}; no database writes were attempted.`);
  }

  const [actualName, image, portsJson, mounts] = inspected.stdout.trim().split('|');
  if (!actualName || actualName !== `/${name}` || !image || !portsJson || !mounts) {
    throw new Error(`Disposable target preflight found an unexpected container name for ${name}.`);
  }

  let ports: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  try {
    ports = JSON.parse(portsJson);
  } catch {
    throw new Error(`Disposable target preflight could not parse port bindings for ${name}.`);
  }

  const portBindings = ports[containerPort];
  const bindings = portBindings || [];
  const matchingBindings = bindings.filter((binding) => binding.HostPort === hostPort);
  if (!matchingBindings.length) {
    throw new Error(`Disposable target preflight found no ${containerPort} to host port ${hostPort} binding on ${name}.`);
  }
  if (matchingBindings.some((binding) => !['127.0.0.1', '::1'].includes(binding.HostIp || ''))) {
    throw new Error(`Disposable target preflight found a non-loopback host binding on ${name}; no writes were attempted.`);
  }

  return { image, mounts, bindings };
}

function verifyDisposableTargetBeforeWrites(): void {
  const config = requireIsolatedConfig();

  const url = new URL(config.url);
  if (url.hostname !== '127.0.0.1' || url.port !== '55321') {
    throw new Error('Bot trade runtime tests require the explicit 127.0.0.1:55321 isolated target.');
  }

  const db = inspectDisposableContainer(expectedDbContainer, '55325', '5432/tcp');
  const api = inspectDisposableContainer(expectedApiContainer, '55321', '8000/tcp');

  if (!db.mounts.includes(`${expectedDbVolume}:/var/lib/postgresql/data`)) {
    throw new Error('Disposable database volume does not match the expected project volume; no writes were attempted.');
  }
  if (db.mounts.includes(originalV4Volume)) {
    throw new Error('Disposable database points at the original V4 volume; no writes were attempted.');
  }
  if (!/postgres/i.test(db.image) || !/kong/i.test(api.image)) {
    throw new Error('Disposable target container images do not match the expected Supabase database/API services.');
  }

  console.info(formatIsolatedTarget(config.url));
  console.info('[ISOLATED BOT TRADE TEST] disposable container, volume, and ports verified; credentials suppressed.');
}

async function cleanupStep(failures: string[], label: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireNoError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

type AuthFixture = { id: string; email: string; password: string };
type CreatedTrade = { id: string; proposerPlayers: string[]; receiverPlayers: string[] };

describe.skipIf(!databaseTestsConfigured)('Isolated bot trade acceptance RPC', () => {
  let admin: SupabaseClient | undefined;
  let roomId: string | undefined;
  let playerSetId: string | undefined;
  let auctionId: string | undefined;
  let host: AuthFixture | undefined;
  let nonHost: AuthFixture | undefined;
  let humanReceiver: AuthFixture | undefined;
  let humanClient: SupabaseClient | undefined;
  let hostClerkId: string | undefined;
  let nonHostClerkId: string | undefined;
  let hostTeamId: string | undefined;
  let botTeamId: string | undefined;
  let humanTeamId: string | undefined;
  let hostPlayerIds: string[] = [];
  let botPlayerIds: string[] = [];
  let humanPlayerIds: string[] = [];
  let roomSettings: Record<string, unknown> = {};
  let createdTrades: CreatedTrade[] = [];

  async function createAuthFixture(label: string): Promise<AuthFixture> {
    const suffix = randomUUID();
    const fixture = {
      email: `bot_trade_${label}_${suffix}@example.com`,
      password: `Test-${randomUUID()}-Only!`,
    };
    const { data, error } = await admin!.auth.admin.createUser({
      email: fixture.email,
      password: fixture.password,
      email_confirm: true,
      user_metadata: { username: `bt_${label}_${suffix.slice(0, 8)}`, display_name: `Trade ${label} fixture` },
    });
    const authUserId = data.user?.id;
    if (authUserId) createdAuthUserIds.push(authUserId);
    requireNoError(error, `${label} isolated auth user creation`);
    if (!authUserId) throw new Error(`${label} isolated auth user creation returned no user.`);

    const { data: profile, error: profileReadError } = await admin!
      .from('profiles').select('id').eq('id', authUserId).maybeSingle();
    requireNoError(profileReadError, `${label} isolated profile lookup`);
    if (!profile) {
      const { error: profileInsertError } = await admin!.from('profiles').insert({
        id: authUserId,
        username: `bt_${label}_${suffix.slice(0, 8)}`,
        display_name: `Trade ${label} fixture`,
      });
      requireNoError(profileInsertError, `${label} isolated profile creation`);
    }
    return { ...fixture, id: authUserId };
  }

  async function createTrade(
    proposerPlayerIds: string[],
    receiverPlayerIds: string[],
    receiverTeamId = botTeamId!,
    expiresAt: string | null = new Date(Date.now() + 60 * 60_000).toISOString(),
  ): Promise<CreatedTrade> {
    const { data, error } = await admin!.from('trades').insert({
      auction_id: auctionId,
      room_id: roomId,
      proposer_team_id: hostTeamId,
      receiver_team_id: receiverTeamId,
      proposer_player_ids: proposerPlayerIds,
      receiver_player_ids: receiverPlayerIds,
      status: 'PENDING',
      expires_at: expiresAt,
    }).select('id').single();
    requireNoError(error, 'isolated trade fixture creation');
    if (!data?.id) throw new Error('Isolated trade fixture creation returned no trade ID.');
    const trade = { id: data.id, proposerPlayers: proposerPlayerIds, receiverPlayers: receiverPlayerIds };
    createdTrades.push(trade);
    return trade;
  }

  async function respondAsBotHost(tradeId: string, clerkSubject = hostClerkId!) {
    return admin!.rpc('v3_respond_bot_trade', {
      p_trade_id: tradeId,
      p_host_clerk_user_id: clerkSubject,
      p_notes: 'isolated bot acceptance test',
    });
  }

  async function expectTradeStatus(tradeId: string, status: string): Promise<void> {
    const { data, error } = await admin!.from('trades').select('status').eq('id', tradeId).single();
    requireNoError(error, 'isolated trade status verification');
    expect(data?.status).toBe(status);
  }

  beforeAll(async () => {
    verifyDisposableTargetBeforeWrites();
    const config = requireIsolatedConfig();
    admin = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    host = await createAuthFixture('host');
    nonHost = await createAuthFixture('nonhost');
    humanReceiver = await createAuthFixture('receiver');
    hostClerkId = `clerk_bot_trade_host_${randomUUID()}`;
    nonHostClerkId = `clerk_bot_trade_nonhost_${randomUUID()}`;

    const { error: mappingError } = await admin.from('clerk_user_mappings').insert([
      { clerk_user_id: hostClerkId, profile_id: host.id },
      { clerk_user_id: nonHostClerkId, profile_id: nonHost.id },
    ]);
    requireNoError(mappingError, 'isolated Clerk mapping creation');

    const { data: playerSet, error: playerSetError } = await admin.from('player_sets').insert({
      name: `Bot trade test ${randomUUID()}`,
      description: 'Disposable bot trade RPC fixture',
      created_by: host.id,
      is_public: false,
    }).select('id').single();
    if (playerSet) playerSetId = playerSet.id;
    requireNoError(playerSetError, 'isolated player set creation');
    if (!playerSetId) throw new Error('Isolated player set creation returned no ID.');

    roomSettings = { max_squad_size: 25, max_overseas: 8, default_purse: 1000 };
    const { data: room, error: roomError } = await admin.from('rooms').insert({
      code: `T${randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase()}`,
      name: 'Disposable bot trade authorization room',
      host_id: host.id,
      settings: roomSettings,
    }).select('id').single();
    if (room) roomId = room.id;
    requireNoError(roomError, 'isolated room creation');
    if (!roomId) throw new Error('Isolated room creation returned no ID.');

    const { data: auction, error: auctionError } = await admin.from('auctions').insert({
      room_id: roomId,
      player_set_id: playerSetId,
      status: 'COMPLETED',
      total_lots: 28,
    }).select('id').single();
    if (auction) auctionId = auction.id;
    requireNoError(auctionError, 'isolated auction creation');
    if (!auctionId) throw new Error('Isolated auction creation returned no ID.');

    const { data: teams, error: teamsError } = await admin.from('teams').insert([
      { auction_id: auctionId, name: 'Fixture Host', short_name: 'HOST', purse: 1000, initial_purse: 1000, players_bought: 11, overseas_count: 1, is_bot: false },
      { auction_id: auctionId, name: 'Fixture Bot', short_name: 'BOT', purse: 1000, initial_purse: 1000, players_bought: 15, overseas_count: 1, is_bot: true },
      { auction_id: auctionId, name: 'Fixture Receiver', short_name: 'RECV', purse: 1000, initial_purse: 1000, players_bought: 2, overseas_count: 0, is_bot: false },
    ]).select('id, short_name');
    requireNoError(teamsError, 'isolated franchise creation');
    hostTeamId = teams?.find((team) => team.short_name === 'HOST')?.id;
    botTeamId = teams?.find((team) => team.short_name === 'BOT')?.id;
    humanTeamId = teams?.find((team) => team.short_name === 'RECV')?.id;
    if (!hostTeamId || !botTeamId || !humanTeamId) throw new Error('Isolated franchise IDs are incomplete.');

    const players = [
      ...Array.from({ length: 10 }, (_, index) => ({ key: `host-${index + 1}`, team: 'host', overseas: false })),
      { key: 'host-overseas', team: 'host', overseas: true },
      ...Array.from({ length: 14 }, (_, index) => ({ key: `bot-${index + 1}`, team: 'bot', overseas: false })),
      { key: 'bot-overseas', team: 'bot', overseas: true },
      ...Array.from({ length: 2 }, (_, index) => ({ key: `human-${index + 1}`, team: 'human', overseas: false })),
    ];
    const namedPlayers = players.map((player) => ({
      ...player,
      name: `${player.key}-${randomUUID().slice(0, 8)}`,
    }));
    const { data: playerRows, error: playersError } = await admin.from('players').insert(namedPlayers.map((player) => ({
      player_set_id: playerSetId,
      name: player.name,
      role: 'BATSMAN',
      category: 'A',
      base_price: 100,
      is_overseas: player.overseas,
    }))).select('id, name');
    requireNoError(playersError, 'isolated player creation');
    const idByKey = new Map<string, string>();
    for (const row of playerRows || []) {
      if (!row?.id) throw new Error('Isolated player creation returned an incomplete result.');
      const inputPlayer = namedPlayers.find((player) => player.name === row.name);
      if (!inputPlayer) throw new Error('Isolated player creation returned an unexpected player row.');
      idByKey.set(inputPlayer.key, row.id);
    }
    hostPlayerIds = [...Array.from({ length: 10 }, (_, index) => idByKey.get(`host-${index + 1}`)!), idByKey.get('host-overseas')!];
    botPlayerIds = [...Array.from({ length: 14 }, (_, index) => idByKey.get(`bot-${index + 1}`)!), idByKey.get('bot-overseas')!];
    humanPlayerIds = [idByKey.get('human-1')!, idByKey.get('human-2')!];

    const lotRows = playerRows!.map((player, index) => ({
      auction_id: auctionId,
      player_id: player.id,
      lot_index: index + 1,
      status: 'PENDING',
      base_price: 100,
    }));
    const { data: lots, error: lotsError } = await admin.from('auction_lots').insert(lotRows).select('id, player_id');
    requireNoError(lotsError, 'isolated auction lot creation');
    if (!lots || lots.length !== players.length) throw new Error('Isolated auction lots were not all created.');
    const lotByPlayerId = new Map(lots.map((lot) => [lot.player_id, lot.id]));
    const squadRows = [
      ...hostPlayerIds.map((playerId) => ({ auction_id: auctionId, team_id: hostTeamId, player_id: playerId, lot_id: lotByPlayerId.get(playerId), purchase_price: 100 })),
      ...botPlayerIds.map((playerId) => ({ auction_id: auctionId, team_id: botTeamId, player_id: playerId, lot_id: lotByPlayerId.get(playerId), purchase_price: 100 })),
      ...humanPlayerIds.map((playerId) => ({ auction_id: auctionId, team_id: humanTeamId, player_id: playerId, lot_id: lotByPlayerId.get(playerId), purchase_price: 100 })),
    ];
    const { error: squadError } = await admin.from('squad_players').insert(squadRows);
    requireNoError(squadError, 'isolated squad ownership creation');

    const { error: participantsError } = await admin.from('room_participants').insert([
      { room_id: roomId, user_id: host.id, team_id: hostTeamId, role: 'HOST' },
      { room_id: roomId, user_id: humanReceiver.id, team_id: humanTeamId, role: 'MEMBER' },
      { room_id: roomId, user_id: nonHost.id, team_id: null, role: 'MEMBER' },
    ]);
    requireNoError(participantsError, 'isolated room participant creation');

    humanClient = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: signInError } = await humanClient.auth.signInWithPassword({
      email: humanReceiver.email,
      password: humanReceiver.password,
    });
    requireNoError(signInError, 'isolated human receiver authentication');
  }, 60_000);

  afterAll(async () => {
    const failures: string[] = [];
    const capturedRoomId = roomId;
    const capturedPlayerSetId = playerSetId;
    const authIds = [...new Set([
      ...createdAuthUserIds,
      host?.id,
      nonHost?.id,
      humanReceiver?.id,
    ].filter((id): id is string => Boolean(id)))];

    if (!admin) {
      if (capturedRoomId || capturedPlayerSetId || authIds.length) {
        throw new Error('Bot trade fixture cleanup cannot run because the isolated admin client was not initialized.');
      }
      return;
    }

    if (capturedRoomId) {
      await cleanupStep(failures, 'room/auction/trade cascade', async () => {
        const { error } = await admin!.from('rooms').delete().eq('id', capturedRoomId);
        requireNoError(error, 'isolated room cascade cleanup');
      });
    }
    if (capturedPlayerSetId) {
      await cleanupStep(failures, 'player set/player cleanup', async () => {
        const { error } = await admin!.from('player_sets').delete().eq('id', capturedPlayerSetId);
        requireNoError(error, 'isolated player set cleanup');
      });
    }
    for (const authId of authIds) {
      await cleanupStep(failures, `auth user ${authId}`, async () => {
        const { error } = await admin!.auth.admin.deleteUser(authId);
        if (error?.status !== 404 && error?.code !== 'user_not_found') requireNoError(error, 'isolated auth user cleanup');
      });
    }

    if (capturedRoomId) {
      await cleanupStep(failures, 'room cleanup verification', async () => {
        const { data, error } = await admin!.from('rooms').select('id').eq('id', capturedRoomId);
        requireNoError(error, 'isolated room cleanup verification');
        if (data?.length) throw new Error('Isolated room remains after cleanup.');
      });
    }
    if (capturedPlayerSetId) {
      await cleanupStep(failures, 'player set cleanup verification', async () => {
        const { data, error } = await admin!.from('player_sets').select('id').eq('id', capturedPlayerSetId);
        requireNoError(error, 'isolated player set cleanup verification');
        if (data?.length) throw new Error('Isolated player set remains after cleanup.');
      });
    }
    for (const authId of authIds) {
      await cleanupStep(failures, `auth user cleanup verification ${authId}`, async () => {
        const { data, error } = await admin!.auth.admin.getUserById(authId);
        if (error?.status === 404 || error?.code === 'user_not_found') return;
        requireNoError(error, 'isolated auth user cleanup verification');
        if (data.user) throw new Error('Isolated auth user remains after cleanup.');
      });
    }

    await humanClient?.auth.signOut();
    if (failures.length) throw new Error(`Bot trade fixture cleanup failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }, 60_000);

  it('allows the verified room host who proposed the trade to accept for a bot receiver atomically', async () => {
    const trade = await createTrade([hostPlayerIds[0]!, hostPlayerIds[1]!], [botPlayerIds[0]!]);
    const competingTrade = await createTrade([hostPlayerIds[0]!], [botPlayerIds[1]!]);
    const { data, error } = await respondAsBotHost(trade.id);

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, trade_id: trade.id, status: 'ACCEPTED' });
    await expectTradeStatus(trade.id, 'ACCEPTED');

    const { data: ownership, error: ownershipError } = await admin!.from('squad_players')
      .select('player_id, team_id').eq('auction_id', auctionId!).in('player_id', trade.proposerPlayers.concat(trade.receiverPlayers));
    requireNoError(ownershipError, 'accepted trade ownership verification');
    expect(ownership).toEqual(expect.arrayContaining([
      expect.objectContaining({ player_id: trade.proposerPlayers[0]!, team_id: botTeamId! }),
      expect.objectContaining({ player_id: trade.proposerPlayers[1]!, team_id: botTeamId! }),
      expect.objectContaining({ player_id: trade.receiverPlayers[0]!, team_id: hostTeamId! }),
    ]));

    const { data: teamCounts, error: teamCountsError } = await admin!.from('teams')
      .select('id, players_bought, overseas_count').in('id', [hostTeamId!, botTeamId!]);
    requireNoError(teamCountsError, 'accepted trade team counter verification');
    expect(teamCounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: hostTeamId!, players_bought: 10, overseas_count: 1 }),
      expect.objectContaining({ id: botTeamId!, players_bought: 16, overseas_count: 1 }),
    ]));

    await expectTradeStatus(competingTrade.id, 'EXPIRED');

    const { data: logs, error: logsError } = await admin!.from('trade_logs')
      .select('action, actor_team_id, actor_user_id').eq('trade_id', trade.id);
    requireNoError(logsError, 'accepted trade audit log verification');
    expect(logs).toHaveLength(1);
    expect(logs?.[0]).toMatchObject({ action: 'ACCEPTED', actor_team_id: botTeamId!, actor_user_id: host!.id });
  });

  it('denies a mapped non-host without changing the pending trade', async () => {
    const trade = await createTrade([hostPlayerIds[1]!], [botPlayerIds[1]!]);
    const { data, error } = await respondAsBotHost(trade.id, nonHostClerkId!);

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: false, error: 'ERR_UNAUTHORIZED_BOT_TRADE_HOST' });
    await expectTradeStatus(trade.id, 'PENDING');
  });

  it('rejects a human receiver on the bot-only path and denies the authenticated role EXECUTE', async () => {
    const trade = await createTrade([hostPlayerIds[2]!], [humanPlayerIds[0]!], humanTeamId!);
    const { data, error } = await respondAsBotHost(trade.id);
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: false, error: 'ERR_BOT_TRADE_RECEIVER_NOT_BOT' });

    const receiverClient = humanClient!;
    const { data: authData, error: authError } = await receiverClient.rpc('v3_respond_bot_trade', {
      p_trade_id: trade.id,
      p_host_clerk_user_id: hostClerkId!,
      p_notes: 'must be denied',
    });
    expect(authError).not.toBeNull();
    expect(authData).toBeNull();
    await expectTradeStatus(trade.id, 'PENDING');
  });

  it('does not grant service_role a general ACCEPT, REJECT, or CANCEL path', async () => {
    const trade = await createTrade([hostPlayerIds[9]!], [botPlayerIds[7]!]);
    const results = await Promise.all(['ACCEPT', 'REJECT', 'CANCEL'].map((action) =>
      admin!.rpc('v3_respond_trade', {
        p_trade_id: trade.id,
        p_action: action,
        p_notes: 'must use the narrowly scoped bot acceptance RPC',
      })
    ));

    for (const result of results) {
      expect(result.error).not.toBeNull();
      expect(result.data).toBeNull();
    }
    await expectTradeStatus(trade.id, 'PENDING');
  });

  it('expires a stale pending proposal without transferring players', async () => {
    const trade = await createTrade([hostPlayerIds[3]!], [botPlayerIds[2]!], botTeamId!, new Date(Date.now() - 1000).toISOString());
    const { data, error } = await respondAsBotHost(trade.id);

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: false, error: 'ERR_TRADE_EXPIRED' });
    await expectTradeStatus(trade.id, 'EXPIRED');
  });

  it('rejects changed player ownership and expires the stale proposal', async () => {
    const trade = await createTrade([hostPlayerIds[4]!], [botPlayerIds[3]!]);
    const { error: ownershipChangeError } = await admin!.from('squad_players')
      .update({ team_id: humanTeamId! }).eq('auction_id', auctionId!).eq('player_id', hostPlayerIds[4]!);
    requireNoError(ownershipChangeError, 'isolated ownership-race fixture setup');

    const { data, error } = await respondAsBotHost(trade.id);
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: false, error: 'ERR_PROPOSER_PLAYER_NO_LONGER_OWNED' });
    await expectTradeStatus(trade.id, 'EXPIRED');
  });

  it('enforces the receiver squad-size limit inside the transaction', async () => {
    const trade = await createTrade([hostPlayerIds[5]!, hostPlayerIds[6]!], [botPlayerIds[4]!]);
    const { error: settingsError } = await admin!.from('rooms')
      .update({ settings: { ...roomSettings, max_squad_size: 15 } }).eq('id', roomId!);
    requireNoError(settingsError, 'isolated squad limit fixture settings');

    const { data, error } = await respondAsBotHost(trade.id);
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: false, error: 'ERR_RECEIVER_SQUAD_LIMIT_EXCEEDED' });
    await expectTradeStatus(trade.id, 'PENDING');
  });

  it('enforces the receiver overseas-player limit inside the transaction', async () => {
    const trade = await createTrade([hostPlayerIds[10]!], [botPlayerIds[5]!]);
    const { error: settingsError } = await admin!.from('rooms')
      .update({ settings: { ...roomSettings, max_overseas: 1 } }).eq('id', roomId!);
    requireNoError(settingsError, 'isolated overseas limit fixture settings');

    const { data, error } = await respondAsBotHost(trade.id);
    expect(error).toBeNull();
    expect(data).toMatchObject({ success: false, error: 'ERR_RECEIVER_OVERSEAS_LIMIT_EXCEEDED' });
    await expectTradeStatus(trade.id, 'PENDING');
  });

  it('rejects a duplicate acceptance after the first atomic response', async () => {
    const trade = await createTrade([hostPlayerIds[7]!], [botPlayerIds[6]!]);
    const [first, second] = await Promise.all([
      respondAsBotHost(trade.id),
      respondAsBotHost(trade.id),
    ]);

    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ success: true, status: 'ACCEPTED' });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ success: false, error: 'ERR_TRADE_NOT_PENDING' });
    const { data: logs, error: logsError } = await admin!.from('trade_logs')
      .select('id').eq('trade_id', trade.id).eq('action', 'ACCEPTED');
    requireNoError(logsError, 'duplicate trade audit verification');
    expect(logs).toHaveLength(1);
  });

  it('keeps human acceptance on the authenticated v3_respond_trade path', async () => {
    const trade = await createTrade([hostPlayerIds[8]!], [humanPlayerIds[1]!], humanTeamId!);
    const { data, error } = await humanClient!.rpc('v3_respond_trade', {
      p_trade_id: trade.id,
      p_action: 'ACCEPT',
      p_notes: 'human receiver acceptance regression',
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, status: 'ACCEPTED' });
    await expectTradeStatus(trade.id, 'ACCEPTED');
  });
});
