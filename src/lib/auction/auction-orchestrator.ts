import { evaluateBotsForLot, AuctionContext, computeFutureQualityMap, computeFutureOverseasByRole, BotDecisionEvidence } from '@/lib/auction/server-bot-engine';
import { syncBotMemoryWithState, clearInactiveAuctionMemory } from '@/lib/auction/bot-brain-memory';
import { updateBotBrainState, clearInactiveBrainStateCache } from '@/lib/auction/bot-brain-state';
import { submitBotBid } from '@/lib/auction/bot-bid-submission';
import { getAuctionRpcFailure } from '@/lib/auction/rpc-response';
import { AUCTION_BOTS_ENABLED } from '@/lib/feature-flags';
import crypto from 'crypto';
import { tickResult, tickRejectionStatus, type TickAction, type TickResult } from './tick-result';
export type { TickResult } from './tick-result';

// Ephemeral Process-Local Evidence Store (Phase 14)
const ephemeralEvidenceStore: Map<string, BotDecisionEvidence[]> = ((globalThis as any).__ephemeralEvidenceStore ??= new Map<string, BotDecisionEvidence[]>());

// Development-only flag for Bot Brain debug logging
const BOT_BRAIN_DEBUG = process.env.NODE_ENV !== 'production';

// Module-level concurrency control: prevents overlapping tick runs on the same auction
const activeAuctionTicks = new Set<string>();

export async function executeAuctionTick(supabase: any): Promise<TickResult> {
  const actionsTaken: TickAction[] = [];

  // Step 0: Process Mini Auction selection expiry for completed parent auctions
  try {
    const miniQuery = supabase
      .from('mini_auction_sessions')
      .select('auction_id, selection_expires_at')
      .eq('status', 'SELECTION_OPEN');
    const { data: expiredMiniSessions, error: miniError } = typeof miniQuery.lte === 'function'
      ? await miniQuery.lte('selection_expires_at', new Date().toISOString())
      : await miniQuery;

    if (miniError) {
      actionsTaken.push({ action: 'READ_MINI_SELECTIONS_FAILED', status: 'failed', error: miniError.message });
    }
    if (!miniError && expiredMiniSessions && expiredMiniSessions.length > 0) {
      for (const session of expiredMiniSessions) {
        const { data: closeRes, error: closeErr } = await supabase.rpc('v3_close_mini_selection', {
          p_auction_id: session.auction_id
        });
        const closeFailure = getAuctionRpcFailure(closeRes, closeErr, 'RPC returned no successful result.');
        if (closeFailure) {
          console.error('[MINI_TICKER] Close mini selection RPC failed.');
          actionsTaken.push({ auction: session.auction_id, action: 'CLOSE_MINI_SELECTION_FAILED', status: 'failed', error: closeFailure });
        } else {
          console.log(`[MINI_TICKER] Closed mini selection for auction ${session.auction_id}.`);
          actionsTaken.push({ auction: session.auction_id, action: 'CLOSE_MINI_SELECTION', status: 'succeeded', result: closeRes });
        }
      }
    }
  } catch {
    console.error('[MINI_TICKER] Failed to process expired mini sessions.');
    actionsTaken.push({ action: 'PROCESS_MINI_SELECTIONS_FAILED', status: 'failed', error: 'Mini-selection processing failed.' });
  }

  // 1. Find active, paused, or mini auctions
  const { data: activeAuctions, error: auctionsError } = await supabase
    .from('auctions')
    .select('id, room_id, status, current_lot_id, current_lot_index, paused_reason')
    .in('status', ['IN_PROGRESS', 'PAUSED', 'MINI_AUCTION']);

  if (auctionsError) throw auctionsError;
  if (!activeAuctions || activeAuctions.length === 0) {
    return tickResult(actionsTaken, actionsTaken.length > 0 ? 'Processed mini ticks' : 'No active or paused auctions');
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
              const resumeFailure = getAuctionRpcFailure(resumeData, resumeError, 'RPC returned no successful result.');
              if (resumeFailure) {
                actionsTaken.push({ auction: auction.id, action: 'RESUME_AUCTION_FAILED', status: 'failed', error: resumeFailure });
                console.error('[TICKER] Resume auction RPC failed.');
              } else {
                console.log(`[TICKER] Resumed auction ${auction.id} after countdown`);
                actionsTaken.push({ auction: auction.id, action: 'RESUME_AUCTION', status: 'succeeded' });
              }
            }
          } catch {
            actionsTaken.push({ auction: auction.id, action: 'RESUME_AUCTION_FAILED', status: 'failed', error: 'Resume state or RPC could not be processed.' });
          }
        }
        continue; // Skip further lot processing for paused auctions
      }

      if (auction.status === 'MINI_AUCTION') {
        const { data: session, error: sessionError } = await supabase
          .from('mini_auction_sessions')
          .select('id, status, selection_expires_at')
          .eq('auction_id', auction.id)
          .single();

        if (sessionError) {
          actionsTaken.push({ auction: auction.id, action: 'READ_MINI_SESSION_FAILED', status: 'failed', error: sessionError.message });
        }
        if (session && session.status === 'SELECTION_OPEN' && session.selection_expires_at) {
          const nowMs = Date.now();
          const expiresMs = new Date(session.selection_expires_at).getTime();
          if (nowMs >= expiresMs) {
            // Timer expired, force close the selection phase
            const { data, error: closeError } = await supabase.rpc('v3_close_mini_selection', {
              p_auction_id: auction.id,
              p_force: true
            });

            const closeFailure = getAuctionRpcFailure(data, closeError, 'RPC returned no successful result.');
            if (closeFailure) {
              console.error('[TICKER] Close mini selection RPC failed.');
              actionsTaken.push({ auction: auction.id, action: 'CLOSE_MINI_SELECTION_FAILED', status: 'failed', error: closeFailure });
            } else {
              console.log(`[TICKER] Closed mini selection for ${auction.id} after timeout`);
              actionsTaken.push({ auction: auction.id, action: 'CLOSE_MINI_SELECTION', status: 'succeeded' });

              // Selection closure does not authorize a start. Preserve the host
              // review step; only explicit host intent may start mini bidding.
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
        const { data: lotData, error: fallbackError } = await supabase
          .from('auction_lots')
          .select(`
            id, lot_index, status, current_bid, base_price, highest_bidder_team_id,
            timer_expires_at, get_ready_expires_at, player_id,
            players (id, name, category, role, country, is_overseas, base_price, age, batting_hand, image_url, matches, runs, batting_average, strike_rate, hundreds, fifties, highest_score, boundaries, overs, wickets, bowling_average, economy_rate, bowling_strike_rate, best_bowling, three_wicket_hauls, catches, stumpings)
          `)
          .eq('auction_id', auction.id)
          .eq('lot_index', auction.current_lot_index)
          .maybeSingle();

        if (fallbackError) {
          actionsTaken.push({ auction: auction.id, action: 'READ_LOT_FAILED', status: 'failed', error: fallbackError.message });
        }
        if (lotData) {
          lot = lotData;
        }
      }

      if (!lot) {
        actionsTaken.push({ auction: auction.id, action: 'READ_LOT_FAILED', status: 'failed', error: 'Current lot is unavailable.' });
        continue;
      }

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
          const rejectionStatus = tickRejectionStatus(data.error);

          console.log(
            `\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=GET_READY\naction=START_BIDDING\nresult=${rejectionStatus === 'skipped' ? 'SKIPPED' : 'FAILED'}\nreason=RPC_REJECTED`
          );

          actionsTaken.push({
            auction: auction.id,
            lot: lot.id,
            action: 'START_BIDDING_REJECTED',
            status: rejectionStatus,
            error: data.error,
          });

          continue;
        }

        const startFailure = getAuctionRpcFailure(data, error, 'RPC returned no successful result.');
        if (startFailure) {
          console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=GET_READY\naction=START_BIDDING\nresult=FAILED\nreason=RPC_FAILED`);
          actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'START_BIDDING_FAILED', status: 'failed', error: startFailure });
          continue;
        }

        console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=GET_READY\naction=START_BIDDING\nresult=APPLIED`);
        actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'START_BIDDING', status: 'succeeded' });
        continue; // Processed this lot for this tick
      } else if (lot.status === 'GET_READY') {
        console.error(`[GET_READY_WAIT] lot=${lot.id} now=${now} expiresAt=${getReadyExpiresAt} diff=${getReadyExpiresAt - now}`);
      }

      if (lot.status === 'BIDDING' && timerExpiresAt && now >= timerExpiresAt) {
        // Re-check latest authoritative lot state from DB to prevent a race where a
        // bid extended the timer after this tick loaded the lot.
        const { data: freshLot, error: freshLotError } = await supabase
          .from('auction_lots')
          .select('id, status, timer_expires_at, current_bid')
          .eq('id', lot.id)
          .single();

        if (freshLotError) {
          actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'READ_LOT_FAILED', status: 'failed', error: freshLotError.message });
          continue;
        }
        const freshExpiresAt = freshLot?.timer_expires_at ? new Date(freshLot.timer_expires_at).getTime() : 0;
        if (!freshLot || freshLot.status !== 'BIDDING' || (freshExpiresAt && Date.now() < freshExpiresAt)) {
          console.log(`[TICKER] Skipping finalization of lot ${lot.id} - timer was extended or status changed (expiresAt: ${freshLot?.timer_expires_at})`);
          actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'FINALIZE_SKIPPED_TIMER_EXTENDED', status: 'skipped' });
          continue;
        }

        // The database must enforce normal due-only finalization atomically as well (p_force: false)
        const { data, error } = await supabase.rpc('v3_finalize_and_advance_lot', {
          p_auction_id: auction.id,
          p_lot_id: lot.id,
          p_force: false
        });

        if (data && data.success === false) {
          const rejectionStatus = tickRejectionStatus(data.error);

          console.log(
            `\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=BIDDING\naction=FINALIZE\nresult=${rejectionStatus === 'skipped' ? 'SKIPPED' : 'FAILED'}\nreason=RPC_REJECTED`
          );

          actionsTaken.push({
            auction: auction.id,
            lot: lot.id,
            action: 'FINALIZE_LOT_REJECTED',
            status: rejectionStatus,
            error: data.error,
          });

          continue;
        }

        const finalizeFailure = getAuctionRpcFailure(data, error, 'RPC returned no successful result.');
        if (finalizeFailure) {
          console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=BIDDING\naction=FINALIZE\nresult=FAILED\nreason=RPC_FAILED`);
          actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'FINALIZE_LOT_FAILED', status: 'failed', error: finalizeFailure });
          continue;
        }

        console.log(`\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nphase=BIDDING\naction=FINALIZE\nresult=APPLIED`);
        actionsTaken.push({ auction: auction.id, lot: lot.id, action: 'FINALIZE_LOT', status: 'succeeded' });
        continue; // Processed this lot for this tick
      }

      if (AUCTION_BOTS_ENABLED && lot.status === 'BIDDING' && timerExpiresAt && now < timerExpiresAt) {
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
          } catch {
            // FAIL-SAFE: Brain state failure must NEVER stop the auction tick
            console.error(`[BOT BRAIN ERROR] auction=${auction.id} bot=${bot.id}`);
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
            () => supabase.rpc('v3_place_bot_bid', {
              p_auction_id: auction.id,
              p_lot_id: lot.id,
              p_team_id: bid.teamId,
              p_request_id: requestId,
              p_expected_current_bid: bid.expectedCurrentBid,
              p_expected_highest_bidder_team_id: bid.expectedHighestBidderTeamId,
              p_expected_next_bid_amount: bid.expectedNextBidAmount,
              p_maximum_bid: Math.floor(bid.maximumBid),
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
              status: 'succeeded',
              team: bid.teamId,
              proposedAmount: bid.nextBidAmount,
              acceptedAmount: acceptedAmount,
              persistedAmount: persistedAmount,
              amount: acceptedAmount,
              result: 'APPLIED'
            });
          } else if (data && data.success === false) {
            console.error(
              `\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nlotIndex=${lot.lot_index}\nphase=BIDDING\naction=BOT_BID\nteam=${bid.teamId}\nproposedAmount=${bid.nextBidAmount}\nresult=REJECTED\nreason=RPC_REJECTED`
            );
            actionsTaken.push({
              auction: auction.id,
              lot: lot.id,
              lotIndex: lot.lot_index,
              action: 'BOT_BID_REJECTED',
              status: tickRejectionStatus(rpcError),
              team: bid.teamId,
              proposedAmount: bid.nextBidAmount,
              result: 'REJECTED',
              error: rpcError
            });
          } else {
            console.error(
              `\nAUCTION_TICK\nauction=${auction.id}\nlot=${lot.id}\nlotIndex=${lot.lot_index}\nphase=BIDDING\naction=BOT_BID\nteam=${bid.teamId}\nproposedAmount=${bid.nextBidAmount}\nresult=FAILED\nreason=RPC_FAILED`
            );
            actionsTaken.push({
              auction: auction.id,
              lot: lot.id,
              lotIndex: lot.lot_index,
              action: 'BOT_BID_FAILED',
              status: 'failed',
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
    } catch {
      actionsTaken.push({ auction: auction.id, action: 'PROCESS_AUCTION_FAILED', status: 'failed', error: 'Auction processing failed.' });
    } finally {
      activeAuctionTicks.delete(auction.id);
    }
  }

  return tickResult(actionsTaken);
}
