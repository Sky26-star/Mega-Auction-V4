import { describe, expect, it } from 'vitest';
import { isStaleCounterParentError } from '@/lib/trade/trade-errors';

describe('isStaleCounterParentError', () => {
  it('recognizes RPC parent and counter relationship rejections', () => {
    for (const error of [
      'ERR_PARENT_TRADE_NOT_FOUND',
      'ERR_PARENT_TRADE_MISMATCH',
      'ERR_PARENT_TRADE_NOT_PENDING',
      'ERR_PARENT_TRADE_EXPIRED',
      'ERR_COUNTER_TEAM_NOT_RECEIVER',
      'ERR_COUNTER_TARGET_MISMATCH',
    ]) {
      expect(isStaleCounterParentError(error)).toBe(true);
    }
  });

  it('does not classify unrelated proposal failures as stale counter context', () => {
    expect(isStaleCounterParentError('ERR_PROPOSER_PLAYERS_NOT_OWNED')).toBe(false);
    expect(isStaleCounterParentError('network timeout')).toBe(false);
    expect(isStaleCounterParentError(undefined)).toBe(false);
  });
});
