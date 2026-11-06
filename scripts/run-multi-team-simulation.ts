// scripts/run-multi-team-simulation.ts
//
// Authoritative Multi-Team Auction Simulation over the Real 202-Player Dataset.
// Runs the real Phase 1–8 pipeline across 10 IPL teams to validate strategic behaviour over time.

import fs from 'fs';
import path from 'path';
import { recordBotBidObservation } from '../src/lib/auction/bot-brain-memory';
import {
  evaluateBotsForLot,
  getNextBidAmount,
  AuctionContext,
  DEFAULT_CONTEXT,
  BotDecisionEvidence,
  computeFutureQualityMap,
  computeFutureOverseasByRole,
} from '../src/lib/auction/server-bot-engine';
import type { V3Team, V3Player } from '../src/lib/v3-auction-types';

function parseReal202Players(): V3Player[] {
  const sqlContent = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '00041_default_player_dataset.sql'), 'utf8');
  const ratingsContent = fs.readFileSync(path.join(process.cwd(), 'COMPLETE_PLAYER_RATINGS_202.md'), 'utf8');

  const ratingMap: Record<string, number> = {};
  for (const line of ratingsContent.split('\n')) {
    const match = line.match(/\|\s*\d+\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([A-Z_]+)\s*\|\s*\*\*(\d+)\*\*\s*\|\s*([A-Z]+)\s*\|\s*₹?(\d+)L/);
    if (match && match[1] && match[3]) ratingMap[match[1].trim()] = parseInt(match[3]);
  }

  const regex = /INSERT INTO public\.players \([^)]+\) VALUES \([^,]+,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+),\s*(true|false),\s*([^,]+),\s*'([^']+)',\s*(\d+),\s*'([^']+)',\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\);/g;

  function cleanVal(v: string) {
    v = v.trim();
    if (v === 'NULL' || v === 'null') return null;
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
    const n = parseFloat(v);
    return isNaN(n) ? v : n;
  }

  const players: V3Player[] = [];
  let match;
  while ((match = regex.exec(sqlContent)) !== null) {
    const name = match[1]!;
    players.push({
      id: 'p_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      name: name,
      role: match[2] as any,
      category: match[3] as any,
      base_price: parseInt(match[4]!),
      is_overseas: match[5] === 'true',
      country: match[7]!,
      age: parseInt(match[8]!),
      batting_hand: match[9]!,
      rating: ratingMap[name] || 85,
      image_url: null,
      matches: cleanVal(match[10]!) as any,
      runs: cleanVal(match[11]!) as any,
      batting_average: cleanVal(match[12]!) as any,
      strike_rate: cleanVal(match[13]!) as any,
      hundreds: cleanVal(match[14]!) as any,
      fifties: cleanVal(match[15]!) as any,
      highest_score: cleanVal(match[16]!) as any,
      boundaries: cleanVal(match[17]!) as any,
      overs: cleanVal(match[18]!) as any,
      wickets: cleanVal(match[19]!) as any,
      bowling_average: cleanVal(match[20]!) as any,
      economy_rate: cleanVal(match[21]!) as any,
      bowling_strike_rate: cleanVal(match[22]!) as any,
      best_bowling: cleanVal(match[23]!) as any,
      three_wicket_hauls: cleanVal(match[24]!) as any,
      catches: cleanVal(match[25]!) as any,
      stumpings: cleanVal(match[26]!) as any,
    });
  }

  return players;
}

function initialize10Teams(): V3Team[] {
  const teamsDef = [
    { id: 'csk', name: 'Chennai Super Kings', short_name: 'CSK' },
    { id: 'mi', name: 'Mumbai Indians', short_name: 'MI' },
    { id: 'rcb', name: 'Royal Challengers Bengaluru', short_name: 'RCB' },
    { id: 'kkr', name: 'Kolkata Knight Riders', short_name: 'KKR' },
    { id: 'srh', name: 'Sunrisers Hyderabad', short_name: 'SRH' },
    { id: 'dc', name: 'Delhi Capitals', short_name: 'DC' },
    { id: 'rr', name: 'Rajasthan Royals', short_name: 'RR' },
    { id: 'pbks', name: 'Punjab Kings', short_name: 'PBKS' },
    { id: 'lsg', name: 'Lucknow Super Giants', short_name: 'LSG' },
    { id: 'gt', name: 'Gujarat Titans', short_name: 'GT' },
  ];

  return teamsDef.map(t => ({
    id: t.id,
    name: t.name,
    short_name: t.short_name,
    purse: 10000, // ₹100 Cr (10,000 Lakhs)
    initial_purse: 10000,
    players_bought: 0,
    overseas_count: 0,
    is_bot: true,
  }));
}

async function runSimulation() {
  console.log('--- STARTING 10-TEAM REAL 202-PLAYER SIMULATION ---');
  const allPlayers = parseReal202Players();
  console.log(`Loaded ${allPlayers.length} real production players from migration.`);

  const teams = initialize10Teams();
  const rosters: Record<string, V3Player[]> = {};
  const purchasePrices: Record<string, number[]> = {};
  for (const t of teams) {
    rosters[t.id] = [];
    purchasePrices[t.id] = [];
  }

  let totalBidsPlaced = 0;
  let bidDecisionsCount = 0;
  let stretchDecisionsCount = 0;
  let passDecisionsCount = 0;
  let maxBidViolations = 0;
  let overseasViolations = 0;
  let squadSizeViolations = 0;
  let illegalBids = 0;

  const lotResults: any[] = [];
  const representativeTraces: any[] = [];

  const maxSquadSize = 25;
  const maxOverseas = 8;

  for (let lotIdx = 0; lotIdx < allPlayers.length; lotIdx++) {
    const player = allPlayers[lotIdx]!;

    // Determine remaining future players
    const futurePlayers = allPlayers.slice(lotIdx + 1).map(p => ({
      player_id: p.id,
      role: p.role,
      category: p.category,
      base_price: p.base_price,
      is_overseas: p.is_overseas,
    }));

    const futureByRole: Record<string, number> = {};
    for (const fp of futurePlayers) {
      futureByRole[fp.role] = (futureByRole[fp.role] || 0) + 1;
    }

    const bps = futurePlayers.map(fp => fp.base_price);
    const auctionProgress = lotIdx / allPlayers.length;

    const ctx: AuctionContext = {
      maxSquadSize,
      maxOverseas,
      totalLots: allPlayers.length,
      lotsCompleted: lotIdx,
      lotsRemaining: futurePlayers.length,
      auctionProgress,
      futurePlayers,
      futureByRole,
      futureOverseasCount: futurePlayers.filter(fp => fp.is_overseas).length,
      futureAvgBasePrice: bps.length > 0 ? bps.reduce((s, v) => s + v, 0) / bps.length : 50,
      futureMinBasePrice: bps.length > 0 ? Math.min(...bps) : 20,
      teamPurchasePrices: purchasePrices,
      futureByRoleAndQuality: computeFutureQualityMap(futurePlayers),
      futureOverseasByRole: computeFutureOverseasByRole(futurePlayers),
    };

    let currentBid = player.base_price;
    let highestBidder: string | undefined = undefined;
    let lotBids = 0;
    let hasStartedBidding = false;
    let lotEvidenceLastRound: BotDecisionEvidence[] = [];

    // Simulate bidding rounds for this player lot
    for (let round = 0; round < 60; round++) {
      const evidence: BotDecisionEvidence[] = [];
      const validBids = evaluateBotsForLot(
        teams,
        player,
        hasStartedBidding ? currentBid : player.base_price,
        player.base_price,
        highestBidder,
        'Normal',
        teams,
        rosters,
        ctx,
        undefined,
        evidence
      );

      lotEvidenceLastRound = evidence;

      for (const ev of evidence) {
        if (ev.finalAction === 'BID') bidDecisionsCount++;
        else if (ev.finalAction === 'STRETCH') stretchDecisionsCount++;
        else passDecisionsCount++;

        // Audit invariant: Did any bot bid when nextRequiredBid > maximumBid?
        if (ev.finalAction !== 'PASS' && ev.nextRequiredBid && ev.maximumBid) {
          if (ev.nextRequiredBid > ev.maximumBid) {
            maxBidViolations++;
            console.error(`[VIOLATION] Bot ${ev.teamId} bid ${ev.nextRequiredBid} exceeding maximumBid ${ev.maximumBid}`);
          }
        }
      }

      // Filter out self-bidding
      const eligible = validBids.filter(b => b.teamId !== highestBidder);
      if (eligible.length === 0) break; // Lot settled

      // Pick first responder
      const winningStep = eligible[0]!;
      // A simulated bid is accepted here; consume the one-last-bid allowance only now.
      recordBotBidObservation(
        (player as V3Player & { auction_id?: string }).auction_id || 'AUCTION',
        winningStep.teamId,
        player.id,
        winningStep.nextBidAmount,
        winningStep.isFinalBid === true
      );
      highestBidder = winningStep.teamId;
      currentBid = winningStep.nextBidAmount;
      hasStartedBidding = true;
      lotBids++;
      totalBidsPlaced++;
    }

    const sold = highestBidder !== undefined;
    let winningPrice = 0;
    if (sold && highestBidder) {
      winningPrice = currentBid;
      const winningTeam = teams.find(t => t.id === highestBidder)!;
      winningTeam.purse -= winningPrice;
      winningTeam.players_bought++;
      if (player.is_overseas) winningTeam.overseas_count++;
      rosters[highestBidder]!.push(player);
      purchasePrices[highestBidder]!.push(winningPrice);

      if (winningTeam.purse < 0) illegalBids++;
      if (winningTeam.overseas_count > maxOverseas) overseasViolations++;
      if (winningTeam.players_bought > maxSquadSize) squadSizeViolations++;
    }

    // Save lot result
    lotResults.push({
      lotIndex: lotIdx + 1,
      playerId: player.id,
      name: player.name,
      role: player.role,
      category: player.category,
      basePrice: player.base_price,
      sold,
      winningTeam: highestBidder || null,
      winningPrice,
      totalBids: lotBids,
    });

    // Capture representative traces
    if (['Virat Kohli', 'Jasprit Bumrah', 'Nicholas Pooran', 'Heinrich Klaasen', 'Mohammed Shami'].includes(player.name) || (sold && representativeTraces.length < 10)) {
      const topEv = lotEvidenceLastRound.find(e => e.teamId === highestBidder) || lotEvidenceLastRound[0];
      if (topEv) {
        representativeTraces.push({
          player: player.name,
          role: player.role,
          category: player.category,
          marketValue: topEv.marketValue,
          teamValue: topEv.teamValue,
          strategicCommitment: topEv.strategicCommitment,
          maximumBid: topEv.maximumBid,
          bindingConstraint: topEv.bindingConstraint,
          finalAction: topEv.finalAction,
          runtimeDecision: topEv.decision,
          winningPrice: sold ? winningPrice : 0,
          winningTeam: highestBidder || 'UNSOLD',
        });
      }
    }
  }

  const soldLots = lotResults.filter(l => l.sold);
  const unsoldLots = lotResults.filter(l => !l.sold);
  const winningPrices = soldLots.map(l => l.winningPrice);
  winningPrices.sort((a, b) => a - b);

  const avgWinningPrice = winningPrices.length > 0 ? winningPrices.reduce((a, b) => a + b, 0) / winningPrices.length : 0;
  const medianWinningPrice = winningPrices.length > 0 ? winningPrices[Math.floor(winningPrices.length / 2)] : 0;

  // Marquee prices (Category MARQUEE / A rating >= 92)
  const marqueeLots = soldLots.filter(l => allPlayers.find(p => p.id === l.playerId)?.rating! >= 93);
  const topPrices = [...soldLots].sort((a, b) => b.winningPrice - a.winningPrice).slice(0, 10);

  const teamSummaries = teams.map(t => ({
    team: t.name,
    short: t.short_name,
    squadSize: t.players_bought,
    overseas: t.overseas_count,
    finalPurse: t.purse,
    spent: t.initial_purse - t.purse,
  }));

  const metrics = {
    totalPlayersAuctioned: allPlayers.length,
    playersSold: soldLots.length,
    playersUnsold: unsoldLots.length,
    totalBidsPlaced,
    bidDecisionsCount,
    stretchDecisionsCount,
    passDecisionsCount,
    averageWinningPriceLakhs: Math.round(avgWinningPrice),
    medianWinningPriceLakhs: medianWinningPrice,
    marqueePlayersCount: marqueeLots.length,
    marqueePrices: marqueeLots.map(m => ({ name: m.name, price: m.winningPrice, team: m.winningTeam })),
    top10Prices: topPrices.map(p => ({ name: p.name, price: p.winningPrice, team: p.winningTeam })),
    teams: teamSummaries,
    violations: {
      maxBidViolations,
      overseasViolations,
      squadSizeViolations,
      illegalBids,
    },
    representativeTraces,
  };

  const outDir = path.join(process.cwd(), 'artifacts', 'phase1-8');
  fs.writeFileSync(path.join(outDir, 'multi-team-simulation-results.json'), JSON.stringify(metrics, null, 2), 'utf8');
  console.log('Results written to artifacts/phase1-8/multi-team-simulation-results.json');
  console.log('Simulation Metrics Summary:', {
    playersSold: metrics.playersSold,
    playersUnsold: metrics.playersUnsold,
    totalBids: metrics.totalBidsPlaced,
    avgPriceLakhs: metrics.averageWinningPriceLakhs,
    medianPriceLakhs: metrics.medianWinningPriceLakhs,
    maxBidViolations: metrics.violations.maxBidViolations,
    overseasViolations: metrics.violations.overseasViolations,
  });
}

runSimulation().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
