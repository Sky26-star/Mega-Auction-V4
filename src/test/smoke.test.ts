import { describe, it, expect } from 'vitest';
import { AUCTION, TEAM_TEMPLATES } from '../lib/auction/constants';
import { ErrorCode, AppError } from '../lib/errors';

describe('Phase 1 Smoke Test', () => {
  it('loads auction constants properly', () => {
    expect(AUCTION.ROOM_CODE_LENGTH).toBe(6);
    expect(AUCTION.DEFAULT_PURSE).toBe(1000);
    expect(AUCTION.DEFAULT_TIMER_DURATION).toBe(15);
    expect(AUCTION.PG_CRON_EXPIRE_LOTS).toBe('10 seconds');
    expect(TEAM_TEMPLATES.length).toBe(10);
  });

  it('instantiates AppError with correct error codes', () => {
    const error = new AppError(ErrorCode.BID_INSUFFICIENT_PURSE, 'Not enough funds');
    expect(error.code).toBe(ErrorCode.BID_INSUFFICIENT_PURSE);
    expect(error.message).toBe('Not enough funds');
  });
});
