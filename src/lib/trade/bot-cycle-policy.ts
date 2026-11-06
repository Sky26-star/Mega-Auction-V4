import type { BotProposalCandidate } from './bot-trade-evaluator';

export const CLOSED_OFFER_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

export interface BotCycleTradeSnapshot {
  status: string;
  proposer_team_id: string;
  receiver_team_id: string;
  proposer_player_ids: string[] | null;
  receiver_player_ids: string[] | null;
  created_at: string;
}

export function isBotTradeWindowOpen(
  auctionStatus: string | null | undefined,
  miniAuctionStatus: string | null | undefined
): boolean {
  return auctionStatus === 'COMPLETED' &&
    (miniAuctionStatus == null || miniAuctionStatus === 'COMPLETED');
}

type BotProposalHistoryRecord = {
  status: string;
  proposer_team?: { is_bot?: boolean };
  receiver_team?: { is_bot?: boolean };
};

/** Bot-to-bot offers that are not completed remain visible as proposal history. */
export function getBotProposalHistory<T extends BotProposalHistoryRecord>(trades: T[]): T[] {
  return trades.filter(trade =>
    trade.status !== 'ACCEPTED' &&
    trade.proposer_team?.is_bot === true &&
    trade.receiver_team?.is_bot === true
  );
}

const CLOSED_OFFER_STATUSES = new Set(['REJECTED', 'EXPIRED', 'CANCELLED', 'COUNTERED']);

export function hasPendingTradeForBot(trades: BotCycleTradeSnapshot[], botTeamId: string): boolean {
  return trades.some(trade =>
    trade.status === 'PENDING' &&
    (trade.proposer_team_id === botTeamId || trade.receiver_team_id === botTeamId)
  );
}

function samePlayerSet(left: string[] | null, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  const ids = new Set(left);
  return ids.size === right.length && right.every(id => ids.has(id));
}

/** Suppress only the same closed offer briefly; unrelated opportunities remain eligible immediately. */
export function isRecentlyClosedDuplicate(
  trades: BotCycleTradeSnapshot[],
  botTeamId: string,
  candidate: BotProposalCandidate,
  now: number,
  cooldownMs = CLOSED_OFFER_RETRY_COOLDOWN_MS
): boolean {
  const offeredIds = candidate.offeredPlayers.map(player => player.id);
  const requestedIds = candidate.requestedPlayers.map(player => player.id);

  return trades.some(trade => {
    if (!CLOSED_OFFER_STATUSES.has(trade.status)) return false;
    const createdAt = Date.parse(trade.created_at);
    if (!Number.isFinite(createdAt) || now - createdAt < 0 || now - createdAt >= cooldownMs) return false;

    const sameDirection =
      trade.proposer_team_id === botTeamId &&
      trade.receiver_team_id === candidate.targetTeam.id &&
      samePlayerSet(trade.proposer_player_ids, offeredIds) &&
      samePlayerSet(trade.receiver_player_ids, requestedIds);
    const reverseDirection =
      trade.proposer_team_id === candidate.targetTeam.id &&
      trade.receiver_team_id === botTeamId &&
      samePlayerSet(trade.proposer_player_ids, requestedIds) &&
      samePlayerSet(trade.receiver_player_ids, offeredIds);

    return sameDirection || reverseDirection;
  });
}

export function isActiveOfferStatus(status: string): boolean {
  return status === 'PENDING';
}

export function isCompletedTradeStatus(status: string): boolean {
  return status === 'ACCEPTED';
}

const botCycleTails = new Map<string, Promise<void>>();

/** Queues concurrent cycle requests in this Next.js process for the same auction. */
export async function acquireBotCycleLock(auctionId: string): Promise<() => void> {
  const previous = botCycleTails.get(auctionId) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>(resolve => { releaseTurn = resolve; });
  const tail = previous.then(() => turn);
  botCycleTails.set(auctionId, tail);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseTurn();
    if (botCycleTails.get(auctionId) === tail) botCycleTails.delete(auctionId);
  };
}
