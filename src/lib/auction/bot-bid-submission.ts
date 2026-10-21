import { recordBotBidObservation } from './bot-brain-memory';

export interface BotBidSubmissionOptions {
  auctionId: string;
  teamId: string;
  playerId: string;
  isFinalBid?: boolean;
}

/**
 * Submit one bot bid and commit its in-memory observation only after the RPC
 * confirms that the bid was applied with a persisted amount.
 */
export async function submitBotBid(
  submit: () => PromiseLike<{ data: any; error: any }>,
  options: BotBidSubmissionOptions
) {
  const { data, error } = await submit();
  const rpcSuccess = !error && Boolean(data && data.success === true);
  const rpcError = error
    ? error.message
    : (Boolean(data && data.success === false) ? (data?.error || 'REJECTED') : null);

  let acceptedAmount: number | null = null;
  let persistedAmount: number | null = null;

  if (rpcSuccess) {
    if (typeof data.amount === 'number') acceptedAmount = data.amount;
    if (typeof data.current_bid === 'number') persistedAmount = data.current_bid;
    else if (acceptedAmount !== null) persistedAmount = acceptedAmount;
    if (acceptedAmount === null && persistedAmount !== null) acceptedAmount = persistedAmount;
  }

  const isApplied = rpcSuccess && acceptedAmount !== null && persistedAmount !== null;
  if (isApplied) {
    recordBotBidObservation(
      options.auctionId,
      options.teamId,
      options.playerId,
      acceptedAmount!,
      options.isFinalBid === true
    );
  }

  return { data, error, rpcSuccess, rpcError, acceptedAmount, persistedAmount, isApplied };
}
