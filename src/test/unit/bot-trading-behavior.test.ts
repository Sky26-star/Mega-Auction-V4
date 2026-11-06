import { describe, expect, it } from 'vitest';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';
import {
  evaluateBotTradeResponse,
  generateBotTradeProposals,
  type BotProposalCandidate,
} from '@/lib/trade/bot-trade-evaluator';
import {
  acquireBotCycleLock,
  hasPendingTradeForBot,
  isActiveOfferStatus,
  isCompletedTradeStatus,
  isBotTradeWindowOpen,
  getBotProposalHistory,
  isRecentlyClosedDuplicate,
  type BotCycleTradeSnapshot,
} from '@/lib/trade/bot-cycle-policy';

const team = (id: string, isBot: boolean, playersBought = 5): V3Team => ({
  id,
  name: id,
  short_name: id,
  purse: 1000,
  initial_purse: 1000,
  players_bought: playersBought,
  overseas_count: 0,
  is_bot: isBot,
});

const player = (id: string, role: string, basePrice = 250): V3Player => ({
  id,
  name: id,
  role: role as V3Player['role'],
  category: 'A',
  base_price: basePrice,
  is_overseas: false,
  country: 'India',
  age: 28,
  batting_hand: 'RIGHT',
  image_url: null,
});

const human = team('human', false);
const botA = team('bot-a', true);
const botB = team('bot-b', true, 3);

function candidate(targetTeam: V3Team = human): BotProposalCandidate {
  return {
    targetTeam,
    offeredPlayers: [player('offered', 'BATSMAN')],
    requestedPlayers: [player('requested', 'WICKET_KEEPER')],
    notes: 'role balance',
  };
}

function closedOffer(status: string, createdAt: string, targetTeamId = 'human'): BotCycleTradeSnapshot {
  return {
    status,
    proposer_team_id: 'bot-a',
    receiver_team_id: targetTeamId,
    proposer_player_ids: ['offered'],
    receiver_player_ids: ['requested'],
    created_at: createdAt,
  };
}

describe('autonomous bot trade behavior', () => {
  it('evaluates an incoming human offer and returns a bot decision', () => {
    const decision = evaluateBotTradeResponse({
      botTeam: botA,
      botPersonality: 'BALANCED',
      proposerTeam: human,
      incomingPlayers: [player('human-marquee', 'BATSMAN', 300)],
      outgoingPlayers: [player('bot-bowler-out', 'BOWLER', 120)],
      botRoster: [player('bot-bowler-out', 'BOWLER', 120), player('bot-bowler-backup', 'BOWLER', 100)],
      proposerRoster: [player('human-marquee', 'BATSMAN', 300)],
    });

    expect(decision.decision).toBe('ACCEPT');
    expect(decision.reason).toBeTruthy();
  });

  it('rejects a human offer that would leave the bot without its only wicket-keeper', () => {
    const decision = evaluateBotTradeResponse({
      botTeam: botA,
      proposerTeam: human,
      incomingPlayers: [player('human-batter', 'BATSMAN', 350)],
      outgoingPlayers: [player('sole-keeper', 'WICKET_KEEPER', 120)],
      botRoster: [player('sole-keeper', 'WICKET_KEEPER', 120), player('bot-batter', 'BATSMAN', 100)],
      proposerRoster: [player('human-batter', 'BATSMAN', 350)],
    });

    expect(decision.decision).toBe('REJECT');
    expect(decision.reason).toMatch(/zero WICKET_KEEPER/i);
  });

  it('generates a proactive offer to a human franchise', () => {
    const botRoster = Array.from({ length: 5 }, (_, i) => player(`bat-${i}`, 'BATSMAN', 250));
    const humanRoster = Array.from({ length: 3 }, (_, i) => player(`wk-${i}`, 'WICKET_KEEPER', 250));
    const proposals = generateBotTradeProposals({
      botTeam: botA,
      botRoster,
      otherTeams: [human],
      allRostersByTeamId: { [human.id]: humanRoster },
    });

    expect(proposals.some(proposal => proposal.targetTeam.id === human.id)).toBe(true);
  });

  it('generates a proactive bot-to-bot proposal', () => {
    const botRoster = Array.from({ length: 5 }, (_, i) => player(`bbat-${i}`, 'BATSMAN', 250));
    const otherBotRoster = Array.from({ length: 3 }, (_, i) => player(`bwk-${i}`, 'WICKET_KEEPER', 250));
    const proposals = generateBotTradeProposals({
      botTeam: botA,
      botRoster,
      otherTeams: [botB],
      allRostersByTeamId: { [botB.id]: otherBotRoster },
    });

    expect(proposals.some(proposal => proposal.targetTeam.id === botB.id)).toBe(true);
  });

  it('lets a receiving bot evaluate a bot-to-bot offer', () => {
    const decision = evaluateBotTradeResponse({
      botTeam: botB,
      proposerTeam: botA,
      incomingPlayers: [player('valuable-batter', 'BATSMAN', 300)],
      outgoingPlayers: [player('surplus-bowler', 'BOWLER', 100)],
      botRoster: [
        player('surplus-bowler', 'BOWLER', 100),
        player('spare-bowler', 'BOWLER', 100),
        player('spare-batter', 'BATSMAN', 80),
      ],
      proposerRoster: [
        player('valuable-batter', 'BATSMAN', 300),
        ...Array.from({ length: 5 }, (_, index) => player(`bot-a-bowler-${index}`, 'BOWLER', 100)),
      ],
    });

    expect(decision.decision).toBe('ACCEPT');
  });

  it('lets a receiving bot counter a close bot-to-bot offer with legal terms', () => {
    const incoming = player('close-batter', 'BATSMAN', 100);
    const extra = player('counter-extra', 'ALL_ROUNDER', 100);
    const outgoing = player('close-bowler', 'BOWLER', 100);
    const decision = evaluateBotTradeResponse({
      botTeam: botB,
      proposerTeam: botA,
      incomingPlayers: [incoming],
      outgoingPlayers: [outgoing],
      botRoster: [outgoing, player('second-bowler', 'BOWLER', 100), player('bot-batter', 'BATSMAN', 100)],
      proposerRoster: [incoming, extra],
    });

    expect(decision.decision).toBe('COUNTER');
    expect(decision.counterOffer?.receiverPlayerIds).toContain(extra.id);
  });

  it('runs bot trading only after the auction and any mini auction are complete', () => {
    expect(isBotTradeWindowOpen('IN_PROGRESS', null)).toBe(false);
    expect(isBotTradeWindowOpen('COMPLETED', 'BIDDING')).toBe(false);
    expect(isBotTradeWindowOpen('COMPLETED', null)).toBe(true);
    expect(isBotTradeWindowOpen('COMPLETED', 'COMPLETED')).toBe(true);
  });

  it('keeps non-final bot-to-bot proposal history separate from completed trades', () => {
    const records = [
      { status: 'PENDING', proposer_team: { is_bot: true }, receiver_team: { is_bot: true } },
      { status: 'COUNTERED', proposer_team: { is_bot: true }, receiver_team: { is_bot: true } },
      { status: 'REJECTED', proposer_team: { is_bot: true }, receiver_team: { is_bot: true } },
      { status: 'ACCEPTED', proposer_team: { is_bot: true }, receiver_team: { is_bot: true } },
      { status: 'PENDING', proposer_team: { is_bot: false }, receiver_team: { is_bot: true } },
    ];

    expect(getBotProposalHistory(records).map(trade => trade.status)).toEqual([
      'PENDING', 'COUNTERED', 'REJECTED',
    ]);
  });

  it.each(['REJECTED', 'EXPIRED'])('permits a fresh opportunity after a %s offer closes', status => {
    const now = Date.parse('2026-10-15T12:00:00.000Z');
    const recent = closedOffer(status, new Date(now - 60_000).toISOString());
    const expiredCooldown = closedOffer(status, new Date(now - 6 * 60_000).toISOString());

    expect(isRecentlyClosedDuplicate([recent], 'bot-a', candidate(), now)).toBe(true);
    expect(isRecentlyClosedDuplicate([expiredCooldown], 'bot-a', candidate(), now)).toBe(false);
    expect(isRecentlyClosedDuplicate([recent], 'bot-a', candidate(botB), now)).toBe(false);
  });

  it('suppresses duplicate pending offers but permits closed trades to be reconsidered', () => {
    expect(hasPendingTradeForBot([{ ...closedOffer('PENDING', new Date().toISOString()) }], 'bot-a')).toBe(true);
    expect(hasPendingTradeForBot([{ ...closedOffer('REJECTED', new Date().toISOString()) }], 'bot-a')).toBe(false);
  });

  it('serializes concurrent cycle requests for the same auction', async () => {
    const releaseFirst = await acquireBotCycleLock('auction-lock-test');
    let secondAcquired = false;
    const second = acquireBotCycleLock('auction-lock-test').then(release => {
      secondAcquired = true;
      return release;
    });

    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    releaseFirst();
    const releaseSecond = await second;
    expect(secondAcquired).toBe(true);
    releaseSecond();
  });

  it('puts only accepted trades in the completed ledger, leaving pending offers active', () => {
    expect(isActiveOfferStatus('PENDING')).toBe(true);
    expect(isActiveOfferStatus('REJECTED')).toBe(false);
    expect(isCompletedTradeStatus('ACCEPTED')).toBe(true);
    expect(isCompletedTradeStatus('PENDING')).toBe(false);
    expect(isCompletedTradeStatus('EXPIRED')).toBe(false);
  });
});
