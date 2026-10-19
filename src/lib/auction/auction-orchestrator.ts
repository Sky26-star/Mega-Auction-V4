import { evaluateBotsForLot, AuctionContext, computeFutureQualityMap, computeFutureOverseasByRole, BotDecisionEvidence } from '@/lib/auction/server-bot-engine';
import { syncBotMemoryWithState, clearInactiveAuctionMemory } from '@/lib/auction/bot-brain-memory';
import { submitBotBid } from '@/lib/auction/bot-bid-submission';
import { updateBotBrainState, clearInactiveBrainStateCache } from '@/lib/auction/bot-brain-state';

// Ephemeral Process-Local Evidence Store (Phase 14)
const ephemeralEvidenceStore = new Map<string, BotDecisionEvidence[]>();

// Development-only flag for Bot Brain debug logging
const BOT_BRAIN_DEBUG = process.env.NODE_ENV !== 'production';

export interface TickResult {
  actions: any[];
  message?: string;
}

export async function executeAuctionTick(supabase: any): Promise<TickResult> {
  const actionsTaken: any[] = [];

  // Step 0: Process Mini Auction selection expiry for completed parent auctions
  try {
    const { data: expiredMiniSessions, error: miniError } = await supabase
      .from('mini_auction_sessions')
      .select('auction_id, selection_expires_at')
      .eq('status', 'SELECTION_OPEN')
      .lte('selection_expires_at', new Date().toISOString());

    if (!miniError && expiredMiniSessions && expiredMiniSessions.length > 0) {
      for (const session of expiredMiniSessions) {
        const { data: closeRes, error: closeErr } = await supabase.rpc('v3_close_mini_selection', {
          p_auction_id: session.auction_id
        });
        if (closeErr) {
          console.error(`[MINI_TICKER] Failed to close mini selection for auction ${session.auction_id}:`, closeErr);
        } else {
          console.log(`[MINI_TICKER] Closed mini selection for auction ${session.auction_id}:`, closeRes);
          actionsTaken.push({ auction: session.auction_id, action: 'CLOSE_MINI_SELECTION', result: closeRes });
        }
      }
    }
  } catch (err: any) {
    console.error('[MINI_TICKER] Error processing expired mini sessions:', err.message || err);
  }

  // 1. Find active or paused auctions
  const { data: activeAuctions, error: auctionsError } = await supabase
    .from('auctions')
    .select('id, room_id, status, current_lot_id, paused_reason')
    .in('status', ['IN_PROGRESS', 'PAUSED']);

  if (auctionsError) throw auctionsError;
  if (!activeAuctions || activeAuctions.length === 0) {
    return { actions: actionsTaken, message: actionsTaken.length > 0 ? 'Processed mini ticks' : 'No active or paused auctions' };
  }

  // Defensive cleanup: find all auctions NOT in the active list and clear their memory/state
  const activeIds = new Set<string>(activeAuctions.map((a: any) => a.id as string));
  clearInactiveAuctionMemory(activeIds);
  clearInactiveBrainStateCache(activeIds);
  for (const key of ephemeralEvidenceStore.keys()) {
    const auctionId = key.split('_')[0];
    if (auctionId && !activeIds.has(auctionId)) {
      ephemeralEvidenceStore.delete(key);
    }
  }

  // 2. Process each active auction
  for (const auction of activeAuctions) {
    if (auction.status === 'PAUSED') {
      if (auction.paused_reason) {
        try {
          const parsed = JSON.parse(auction.paused_reason);
          if (parsed.resume_expires_at && Date.now() >= parsed.resume_expires_at) {
            const { error: resumeError } = await supabase.rpc('resume_auction', { p_auction_id: auction.id });
            if (resumeError) {
              console.error(`[TICKER] Failed to resume auction ${auction.id}:`, resumeError);
            } else {
              console.log(`[TICKER] Resumed auction ${auction.id} after countdown`);
              actionsTaken.push({ auction: auction.id, action: 'RESUME_AUCTION' });
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      continue; // Skip further lot processing for paused auctions
    }

    if (!auction.current_lot_id) continue;

    // Read current lot authoritative state
    const { data: lot, error: lotError } = await supabase
      .from('auction_lots')
      .select(`
        id, lot_index, status, current_bid, base_price, highest_bidder_team_id,
        timer_expires_at, get_ready_expires_at, player_id,
        players (id, name, category, role, country, is_overseas, base_price, age, batting_hand, image_url, matches, runs, batting_average, strike_rate, hundreds, fifties, highest_score, boundaries, overs, wickets, bowling_average, economy_rate, bowling_strike_rate, best_bowling, three_wicket_hauls, catches, stumpings)
      `)
      .eq('id', auction.current_lot_id)
      .single();

    if (lotError || !lot) continue;

    const now = Date.now();
    const getReadyExpiresAt = lot.get_ready_expires_at ? new Date(lot.get_ready_expires_at).getTime() : 0;
    const timerExpiresAt = lot.timer_expires_at ? new Date(lot.timer_expires_at).getTime() : 0;

    // Check transitions
    if (lot.status === 'GET_READY' && getReadyExpiresAt && now >= getReadyExpiresAt) {
      // Transition to BIDDING
      const { data, error } = await supabase.rpc('v3_start_bidding', {
        p_auction_id: auction.id,
        p_lot_id: lot.id,
        p_force: true
      });

      if (data && data.success === false) {
         console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=GET_READY\naction=START_BIDDING\nresult=SKIPPED\nreason=${data.error}`);
         actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'START_BIDDING_REJECTED', error: data.error });
         continue;
      }

      console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=GET_READY\naction=START_BIDDING\nresult=APPLIED`);
      actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'START_BIDDING', error: error?.message });
      continue; // Processed this lot for this tick
    }

    if (lot.status === 'BIDDING' && timerExpiresAt && now >= timerExpiresAt) {
      // Transition to SOLD/UNSOLD and advance
      const { data, error } = await supabase.rpc('v3_finalize_and_advance_lot', {
        p_auction_id: auction.id,
        p_lot_id: lot.id,
        p_force: true
      });

      if (data && data.success === false) {
         console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=BIDDING\naction=FINALIZE\nresult=SKIPPED\nreason=${data.error}`);
         actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'FINALIZE_LOT_REJECTED', error: data.error });
         continue;
      }

      console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=BIDDING\naction=FINALIZE\nresult=APPLIED`);
      actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'FINALIZE_LOT', error: error?.message });
      continue; // Processed this lot for this tick
    }

    if (lot.status === 'BIDDING' && timerExpiresAt && now < timerExpiresAt) {
      // Bot evaluation time
      // Need Room Settings, Bot Teams, All Teams, Active Squad Players, and future lots for context
      const [{ data: room }, { data: allTeamsData }, { data: allLots }, { data: squadPlayersData }] = await Promise.all([
        supabase.from('rooms').select('settings').eq('id', auction.room_id).single(),
        supabase.from('teams').select('*').eq('auction_id', auction.id),
        supabase.from('auction_lots').select('id, player_id, status, base_price, winning_team_id, winning_bid, players(id, role, category, base_price, is_overseas)').eq('auction_id', auction.id),
        supabase.from('squad_players').select('team_id, purchase_price, players(id, role, category, base_price, is_overseas)').eq('auction_id', auction.id)
      ]);

      if (!room || !allTeamsData || !allLots) continue;

      const allTeamsRaw = allTeamsData as any[];

      // Build context first to count rosters
      const settings = (room.settings || {}) as any;
      const rosters: Record<string, any[]> = {};
      const purchasePrices: Record<string, number[]> = {};
      const futurePlayers: any[] = [];

      // 1. CANONICAL ACTIVE ROSTER: Reconstructed from public.squad_players
      // Historical auction_lots (status='SOLD') is NOT used for active squad membership,
      // ensuring that players released in Mini Auction are accurately reflected as no longer owned.
      const activeSquad = (squadPlayersData || []) as any[];
      for (const sp of activeSquad) {
        const p = sp.players as any;
        const tid = sp.team_id as string;
        if (tid && p) {
          if (!rosters[tid]) rosters[tid] = [];
          rosters[tid].push(p);
          if (!purchasePrices[tid]) purchasePrices[tid] = [];
          purchasePrices[tid].push(sp.purchase_price || 0);
        }
      }

      // 2. FUTURE POOL: Reconstructed from pending auction_lots
      for (const l of allLots) {
        const p = l.players as any;
        if (l.status === 'PENDING' && p) {
          futurePlayers.push({
            player_id: l.player_id || p.id,
            role: p.role || 'BATSMAN',
            category: p.category || 'D',
            base_price: p.base_price || l.base_price,
            is_overseas: p.is_overseas || false
          });
        }
      }

      const futureByRole: Record<string, number> = {};
      for (const fp of futurePlayers) {
        futureByRole[fp.role] = (futureByRole[fp.role] || 0) + 1;
      }
      const bps = futurePlayers.map(fp => fp.base_price);

      const lotsCompleted = allLots.filter((l: any) => l.status === 'SOLD' || l.status === 'UNSOLD').length;

      const ctx: AuctionContext = {
        maxSquadSize: settings.max_squad_size || 25,
        maxOverseas: settings.max_overseas || 8,
        totalLots: allLots.length,
        futurePlayers,
        futureByRole,
        futureOverseasCount: futurePlayers.filter(fp => fp.is_overseas).length,
        futureAvgBasePrice: bps.length > 0 ? bps.reduce((s, v) => s + v, 0) / bps.length : 50,
        futureMinBasePrice: bps.length > 0 ? Math.min(...bps) : 20,
        teamPurchasePrices: purchasePrices,
        // Enriched context for bot intelligence (computed from existing data)
        lotsCompleted,
        lotsRemaining: futurePlayers.length,
        auctionProgress: allLots.length > 0 ? lotsCompleted / allLots.length : 0,
        futureByRoleAndQuality: computeFutureQualityMap(futurePlayers),
        futureOverseasByRole: computeFutureOverseasByRole(futurePlayers),
      };

      const allTeams = allTeamsRaw.map(t => ({
        id: t.id,
        name: t.name,
        short_name: t.short_name,
        purse: t.purse,
        initial_purse: t.initial_purse || 10000,
        players_bought: t.players_bought ?? (rosters[t.id]?.length || 0),
        overseas_count: t.overseas_count ?? (rosters[t.id]?.filter(p => p.is_overseas).length || 0),
        is_bot: !!t.is_bot
      }));

      const botTeams = allTeams.filter(t => t.is_bot);
      if (botTeams.length === 0) continue;

      // Phase 1B: Sync memory for all bots before evaluation
      for (const bot of botTeams) {
        syncBotMemoryWithState(auction.id, bot.id, auction.current_lot_id, allLots);
      }

      // Phase 1D: Calculate BotBrainState (beliefs + plan) for each bot.
      // OBSERVATIONAL ONLY — state is cached but NOT passed into evaluateBotsForLot().
      // FAIL-SAFE: If brain state calculation fails for any bot, log the error
      // and continue — the existing auction engine must never be blocked.
      const player = lot.players as any;
      for (const bot of botTeams) {
        try {
          const brainState = updateBotBrainState({
            auctionId: auction.id,
            teamId: bot.id,
            bot,
            botRoster: rosters[bot.id] || [],
            currentBid: lot.current_bid,
            basePrice: lot.base_price,
            playerRole: player?.role || 'BATSMAN',
            playerIsOverseas: player?.is_overseas || false,
            allTeams,
            teamRosters: rosters,
            ctx,
          });

          if (BOT_BRAIN_DEBUG) {
            console.log(
              `[BOT BRAIN] auction=${auction.id} bot=${bot.short_name} ` +
              `focus=${brainState.plan.strategicFocus} urgency=${brainState.plan.urgency.toFixed(2)} ` +
              `inflation=${brainState.beliefs.marketInflation.toFixed(2)} ` +
              `rolePanic=${brainState.beliefs.roleScarcityPanic.toFixed(2)} ` +
              `rivalAgg=${brainState.beliefs.rivalAggression.toFixed(2)}`
            );
          }
        } catch (brainErr) {
          // FAIL-SAFE: Brain state failure must NEVER stop the auction tick.
          // Log for dev visibility but allow evaluateBotsForLot() to proceed.
          console.error(`[BOT BRAIN ERROR] auction=${auction.id} bot=${bot.id}`, brainErr);
        }
      }

      const outEvidenceLog: BotDecisionEvidence[] = [];
      const validBids = evaluateBotsForLot(
        botTeams,
        player,
        lot.current_bid,
        lot.base_price,
        lot.highest_bidder_team_id,
        settings.bot_difficulty || 'Normal',
        allTeams,
        rosters,
        ctx,
        lot.timer_expires_at,
        outEvidenceLog,
        auction.id
      );

      // Store evidence (latest-write-wins per tick)
      const evidenceKey = `${auction.id}_${lot.id}`;
      ephemeralEvidenceStore.set(evidenceKey, outEvidenceLog);

      console.log(`[BOT EVAL] Lot: ${lot.id}, Bots: ${botTeams.length}, ValidBids: ${validBids.length}, Evidence: ${outEvidenceLog.length}`);

      // Execute valid bids
      for (const bid of validBids) {
        // Check if timer still allows
        const timerDurationMs = (settings.timer_duration_seconds || 15) * 1000;
        const timeSinceStart = timerExpiresAt ? timerDurationMs - (timerExpiresAt - Date.now()) : 0;
        if (timeSinceStart < bid.delayMs) continue;

        // Place the bid via RPC
        const requestId = crypto.randomUUID();

        const { data, rpcError, acceptedAmount, isApplied } = await submitBotBid(
          () => supabase.rpc('v3_place_bid', {
            p_auction_id: auction.id,
            p_lot_id: lot.id,
            p_team_id: bid.teamId,
            p_request_id: requestId,
            p_is_bot: true
          }),
          {
            auctionId: auction.id,
            teamId: bid.teamId,
            playerId: lot.player_id,
            isFinalBid: bid.isFinalBid,
          }
        );
        const isAccepted = isApplied;

        console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=BIDDING\naction=BOT_BID\nteam=${bid.teamId}\nproposed=${bid.nextBidAmount}\namount=${acceptedAmount ?? 'UNKNOWN'}\nresult=${isAccepted ? 'APPLIED' : 'FAILED'}`);
        actionsTaken.push({ auction: auction.id, lot: lot.id, action: isAccepted ? 'BOT_BID' : 'BOT_BID_FAILED', team: bid.teamId, amount: acceptedAmount ?? undefined, error: rpcError || data?.error });

        // Only one bid per tick to avoid race conditions and simulate human delay
        break;
      }
    }
  }

  return { actions: actionsTaken };
}
