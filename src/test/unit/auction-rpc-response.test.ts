import { describe, expect, it } from 'vitest';
import { getAuctionRpcFailure } from '@/lib/auction/rpc-response';
import { submitBotBid } from '@/lib/auction/bot-bid-submission';

describe('auction RPC response handling', () => {
  it('accepts only an explicit successful JSON result', () => {
    expect(getAuctionRpcFailure({ success: true }, null, 'fallback')).toBeNull();
    expect(getAuctionRpcFailure({ success: false, error: 'ERR_UNAUTHORIZED' }, null, 'fallback'))
      .toBe('ERR_UNAUTHORIZED');
  });

  it('fails closed for missing, malformed, or unsuccessful responses', () => {
    expect(getAuctionRpcFailure(null, null, 'fallback')).toBe('fallback');
    expect(getAuctionRpcFailure(undefined, null, 'fallback')).toBe('fallback');
    expect(getAuctionRpcFailure({}, null, 'fallback')).toBe('fallback');
    expect(getAuctionRpcFailure([], null, 'fallback')).toBe('fallback');
  });

  it('preserves transport error messages', () => {
    expect(getAuctionRpcFailure(null, { message: 'connection lost' }, 'fallback'))
      .toBe('connection lost');
    expect(getAuctionRpcFailure(null, 'network unavailable', 'fallback'))
      .toBe('network unavailable');
  });

  it('does not mark a bot bid applied when the RPC omits a confirmation', async () => {
    const result = await submitBotBid(
      async () => ({ data: null, error: null }),
      { auctionId: 'auction', teamId: 'team', playerId: 'player' }
    );

    expect(result.rpcSuccess).toBe(false);
    expect(result.rpcError).toBe('RPC did not return a successful confirmation.');
    expect(result.isApplied).toBe(false);
    expect(result.acceptedAmount).toBeNull();
    expect(result.persistedAmount).toBeNull();
  });
});
