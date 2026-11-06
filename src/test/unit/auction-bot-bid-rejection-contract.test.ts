import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tickRejectionStatus } from '../../lib/auction/tick-result';

describe('Bot bid rejection safety contract', () => {
  it('treats unknown, authorization, and database errors as failures', () => {
    expect(tickRejectionStatus('ERR_PERMISSION_DENIED')).toBe('failed');
    expect(tickRejectionStatus('ERR_DATABASE_FAILURE')).toBe('failed');
    expect(tickRejectionStatus('permission denied')).toBe('failed');
    expect(tickRejectionStatus(undefined)).toBe('failed');
  });

  it('skips only explicitly recognized race and expiry guards', () => {
    const safeSkips = [
      'ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS',
      'ERR_LOT_NOT_BIDDING',
      'ERR_TIMER_NOT_EXPIRED',
      'ERR_LOT_NOT_GET_READY',
    ];

    for (const code of safeSkips) {
      expect(tickRejectionStatus(code)).toBe('skipped');
    }
  });

  it('requires bot bid rejection to use the fail-closed classifier', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/auction/auction-orchestrator.ts'),
      'utf8'
    );

    expect(source).toMatch(
      /action:\s*'BOT_BID_REJECTED',\s*status:\s*tickRejectionStatus\(rpcError\)/
    );
  });
});