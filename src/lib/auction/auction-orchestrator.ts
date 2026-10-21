import { evaluateBotsForLot, AuctionContext, computeFutureQualityMap, computeFutureOverseasByRole, BotDecisionEvidence } from '@/lib/auction/server-bot-engine';
import { syncBotMemoryWithState, clearInactiveAuctionMemory } from '@/lib/auction/bot-brain-memory';
import { updateBotBrainState, clearInactiveBrainStateCache } from '@/lib/auction/bot-brain-state';
import { submitBotBid } from '@/lib/auction/bot-bid-submission';
import crypto from 'crypto';

// Ephemeral Process-Local Evidence Store (Phase 14)
const ephemeralEvidenceStore: Map<string, BotDecisionEvidence[]> = ((globalThis as any).__ephemeralEvidenceStore ??= new Map<string, BotDecisionEvidence[]>());

// Development-only flag for Bot Brain debug logging
const BOT_BRAIN_DEBUG = process.env.NODE_ENV !== 'production';

// Module-level concurrency control: prevents overlapping tick runs on the same auction
const activeAuctionTicks = new Set<string>();

export interface TickResult {
  actions: any[];
  message?: string;
}

export async function executeAuctionTick(supabase: any): Promise<TickResult> {
  const actionsTaken: any[] = [];

  // Step 0: Process Mini Auction selection expiry for completed parent auctions
  try {
    const miniQuery = supabase
      .from('mini_auction_sessions')
      .select('auction_id, selection_expires_at')
      .eq('status', 'SELECTION_OPEN');
    const { data: expiredMiniSessions, error: miniError } = typeof miniQuery.lte === 'function'
      ? await miniQuery.lte('selection_expires_at', new Date().toISOString())
      : await miniQuery;

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

  // 1. Find active, paused, or mini auctions
  const { data: activeAuctions, error: auctionsError } = await supabase
    .from('auctions')
    .select('id, room_id, status, current_lot_id, current_lot_index, paused_reason')
    .in('status', ['IN_PROGRESS', 'PAUSED', 'MINI_AUCTION']);

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
    if (activeAuctionTicks.has(auction.id)) {
      console.log(`[TICKER] Skipping auction ${auction.id} - tick already in progress`);
      continue;
    }
    activeAuctionTicks.add(auction.id);

    try {
      if (auction.status === 'PAUSED') {
        if (auction.paused_reason) {
          try {
            const parsed = JSON.parse(auction.paused_reason);
            if (parsed.resume_expires_at && Date.now() >= parsed.resume_expires_at) {
              const { data: resumeData, error: resumeError } = await supabase.rpc('resume_auction', { p_auction_id: auction.id });
              if (resumeError || (resumeData && !resumeData.success)) {
                console.error(`[TICKER] Failed to resume auction ${auction.id}:`, resumeError || resumeData?.error);
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

      if (auction.status === 'MINI_AUCTION') {
        const { data: session } = await supabase
          .from('mini_auction_sessions')
          .select('id, status, selection_expires_at')
          .eq('auction_id', auction.id)
          .single();

        if (session && session.status === 'SELECTION_OPEN' && session.selection_expires_at) {
          const nowMs = Date.now();
          const expiresMs = new Date(session.selection_expires_at).getTime();
          if (nowMs >= expiresMs) {
            // Timer expired, force close the selection phase
            const { data, error: closeError } = await supabase.rpc('v3_close_mini_selection', {
              p_auction_id: auction.id,
              p_force: true
            });

            if (closeError || (data && !data.success)) {
              console.error(`[TICKER] Failed to close mini selection for ${auction.id}:`, closeError || data?.error);
              actionsTaken.push({ auction: auction.id, action: 'CLOSE_MINI_SELECTION_FAILED', error: closeError?.message || data?.error });
            } else {
              console.log(`[TICKER] Closed mini selection for ${auction.id} after timeout`);
              actionsTaken.push({ auction: auction.id, action: 'CLOSE_MINI_SELECTION' });

              // Automatically start the Mini Auction if there are valid nominations
              if (data.total_lots > 0) {
                const { data: startData, error: startError } = await supabase.rpc('v3_start_mini_auction', { p_auction_id: auction.id });
                if (startError || (startData && !startData.success)) {
                  console.error(`[TICKER] Failed to auto-start mini auction for ${auction.id}:`, startError || startData?.error);
                  actionsTaken.push({ auction: auction.id, action: 'START_MINI_AUCTION_FAILED', error: startError?.message || startData?.error });
                } else {
                  console.log(`[TICKER] Auto-started mini auction for ${auction.id}`);
                  actionsTaken.push({ auction: auction.id, action: 'START_MINI_AUCTION' });
                }
              }
            }
          }
        }
        continue;
      }

      let lot: any = null;
      if (auction.current_lot_id) {
        const { data: lotData, error: lotError } = await supabase
          .from('auction_lots')
          .select(`
            id, lot_index, status, current_bid, base_price, highest_bidder_team_id,
            timer_expires_at, get_ready_expires_at, player_id,
            players (id, name, category, role, country, is_overseas, base_price, age, batting_hand, image_url, matches, runs, batting_average, strike_rate, hundreds, fifties, highest_score, boundaries, overs, wickets, bowling_average, economy_rate, bowling_strike_rate, best_bowling, three_wicket_hauls, catches, stumpings)
          `)
          .eq('id', auction.current_lot_id)
          .single();

        if (!lotError && lotData) {
          lot = lotData;
        }
      }

      if (!lot && typeof auction.current_lot_index === 'number') {
        const { data: lotData } = await supabase
          .from('auction_lots')
          .select(`
            id, lot_index, status, current_bid, base_price, highest_bidder_team_id,
            timer_expires_at, get_ready_expires_at, player_id,
            players (id, name, category, role, country, is_overseas, base_price, age, batting_hand, image_url, matches, runs, batting_average, strike_rate, hundreds, fifties, highest_score, boundaries, overs, wickets, bowling_average, economy_rate, bowling_strike_rate, best_bowling, three_wicket_hauls, catches, stumpings)
          `)
          .eq('auction_id', auction.id)
          .eq('lot_index', auction.current_lot_index)
          .maybeSingle();

        if (lotData) {
          lot = lotData;
        }
      }

      if (!lot) continue;

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
      } else if (lot.status === 'GET_READY') {
        console.error(`[GET_READY_WAIT] lot=${lot.id} now=${now} expiresAt=${getReadyExpiresAt} diff=${getReadyExpiresAt - now}`);
      }

      if (lot.status === 'BIDDING' && timerExpiresAt && now >= timerExpiresAt) {
        // Re-check latest authoritative lot state from DB to prevent a race where a
        // bid extended the timer after this tick loaded the lot.
        const { data: freshLot } = await supabase
          .from('auction_lots')
          .select('id, status, timer_expires_at, current_bid')
          .eq('id', lot.id)
          .single();

        const freshExpiresAt = freshLot?.timer_expires_at ? new Date(freshLot.timer_expires_at).getTime() : 0;
        if (!freshLot || freshLot.status !== 'BIDDING' || (freshExpiresAt && Date.now() < freshExpiresAt)) {
          console.log(`[TICKER] Skipping finalization of lot ${lot.id} - timer was extended or status changed (expiresAt: ${freshLot?.timer_expires_at})`);
          actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'FINALIZE_SKIPPED_TIMER_EXTENDED' });
          continue;
        }

        // The database must enforce normal due-only finalization atomically as well (p_force: false)
        const { data, error } = await supabase.rpc('v3_finalize_and_advance_lot', {
          p_auction_id: auction.id,
          p_lot_id: lot.id,
          p_force: false
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
        if (activeSquad.length > 0) {
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
        } else {
          // Fallback for test harnesses that mock only auction_lots
          for (const l of allLots) {
            const p = l.players as any;
            const tid = l.winning_team_id as string;
            if (l.status === 'SOLD' && tid && p) {
              if (!rosters[tid]) rosters[tid] = [];
              rosters[tid].push(p);
              if (!purchasePrices[tid]) purchasePrices[tid] = [];
              purchasePrices[tid].push(l.winning_bid || l.base_price);
            }
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
          futureOverseasCount: futurePlayers.filter((fp: any) => fp.is_overseas).length,
          futureAvgBasePrice: bps.length > 0 ? bps.reduce((s: number, v: number) => s + v, 0) / bps.length : 50,
          futureMinBasePrice: bps.length > 0 ? Math.min(...bps) : 20,
          teamPurchasePrices: purchasePrices,
          lotsCompleted,
          lotsRemaining: futurePlayers.length,
          auctionProgress: allLots.length > 0 ? lotsCompleted / allLots.length : 0,
          futureByRoleAndQuality: computeFutureQualityMap(futurePlayers),
          futureOverseasByRole: computeFutureOverseasByRole(futurePlayers),
        };

        const allTeams = allTeamsRaw.map((t: any) => ({
          id: t.id,
          name: t.name,
          short_name: t.short_name,
          purse: t.purse,
          initial_purse: t.initial_purse || 10000,
          players_bought: t.players_bought ?? (rosters[t.id]?.length || 0),
          overseas_count: t.overseas_count ?? (rosters[t.id]?.filter((p: any) => p.is_overseas).length || 0),
          is_bot: !!t.is_bot
        }));

        const botTeams = allTeams.filter((t: any) => t.is_bot);
        if (botTeams.length === 0) continue;

        // Sync memory for all bots before evaluation
        for (const bot of botTeams) {
          syncBotMemoryWithState(auction.id, bot.id, auction.current_lot_id, allLots);
        }

        // Calculate BotBrainState (beliefs + plan) for each bot
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
            // FAIL-SAFE: Brain state failure must NEVER stop the auction tick
            console.error(`[BOT BRAIN ERROR] auction=${auction.id} bot=${bot.id}`, brainErr);
          }
        }

        const effectiveCurrentBid = lot.highest_bidder_team_id ? lot.current_bid : 0;
        const outEvidenceLog: BotDecisionEvidence[] = [];
        const validBids = evaluateBotsForLot(
          botTeams,
          player,
          effectiveCurrentBid,
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

          // Place the bid via RPC with retry and observation tracking
          const requestId = crypto.randomUUID();

          const { data, error, rpcError, acceptedAmount, persistedAmount, isApplied } = await submitBotBid(
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

          if (isApplied) {
            console.error(
              `\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nlotIndex=${lot.lot_index}\nphase=BIDDING\naction=BOT_BID\nteam=${bid.teamId}\nproposedAmount=${bid.nextBidAmount}\nacceptedAmount=${acceptedAmount}\npersistedAmount=${persistedAmount}\namount=${acceptedAmount}\nresult=APPLIED`
            );
            actionsTaken.push({
              auction: auction.id,
              lot: lot.id,
              lotIndex: lot.lot_index,
              action: 'BOT_BID',
              team: bid.teamId,
              proposedAmount: bid.nextBidAmount,
              acceptedAmount: acceptedAmount,
              persistedAmount: persistedAmount,
              amount: acceptedAmount,
              result: 'APPLIED'
            });
          } else if (data && data.success === false) {
            console.error(
              `\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nlotIndex=${lot.lot_index}\nphase=BIDDING\naction=BOT_BID\nteam=${bid.teamId}\nproposedAmount=${bid.nextBidAmount}\nresult=REJECTED\nreason=${rpcError}`
            );
            actionsTaken.push({
              auction: auction.id,
              lot: lot.id,
              lotIndex: lot.lot_index,
              action: 'BOT_BID_REJECTED',
              team: bid.teamId,
              proposedAmount: bid.nextBidAmount,
              result: 'REJECTED',
              error: rpcError
            });
          } else {
            console.error(
              `\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nlotIndex=${lot.lot_index}\nphase=BIDDING\naction=BOT_BID\nteam=${bid.teamId}\nproposedAmount=${bid.nextBidAmount}\nresult=FAILED\nreason=${rpcError || 'RPC did not confirm accepted amount'}`
            );
            actionsTaken.push({
              auction: auction.id,
              lot: lot.id,
              lotIndex: lot.lot_index,
              action: 'BOT_BID_FAILED',
              team: bid.teamId,
              proposedAmount: bid.nextBidAmount,
              result: 'FAILED',
              error: rpcError || 'RPC did not confirm accepted amount'
            });
          }

          // Only one bid per tick to avoid race conditions and simulate human delay
          break;
        }
      }
    } finally {
      activeAuctionTicks.delete(auction.id);
    }
  }

  return { actions: actionsTaken };
}
