// src/test/unit/bid-increments.test.ts
// Official Mega Auction Bid Increments Test Suite

import { describe, it, expect } from 'vitest';
import { getBidIncrement, getNextMinimumBid } from '@/lib/auction/bid-increments';

describe('Mega Auction Bid Increments Engine', () => {
  const TEST_MATRIX = [
    { currentBid: 1.00, expectedIncrement: 0.25, expectedNextMin: 1.25 },
    { currentBid: 2.00, expectedIncrement: 0.25, expectedNextMin: 2.25 },
    { currentBid: 3.00, expectedIncrement: 0.25, expectedNextMin: 3.25 },
    { currentBid: 3.25, expectedIncrement: 0.50, expectedNextMin: 3.75 },
    { currentBid: 6.00, expectedIncrement: 0.50, expectedNextMin: 6.50 },
    { currentBid: 6.50, expectedIncrement: 0.75, expectedNextMin: 7.25 },
    { currentBid: 10.00, expectedIncrement: 0.75, expectedNextMin: 10.75 },
    { currentBid: 10.75, expectedIncrement: 1.00, expectedNextMin: 11.75 },
    { currentBid: 12.50, expectedIncrement: 1.00, expectedNextMin: 13.50 },
    { currentBid: 15.00, expectedIncrement: 1.00, expectedNextMin: 16.00 },
    { currentBid: 15.50, expectedIncrement: 1.50, expectedNextMin: 17.00 },
    { currentBid: 20.00, expectedIncrement: 1.50, expectedNextMin: 21.50 },
    { currentBid: 20.50, expectedIncrement: 1.75, expectedNextMin: 22.25 },
    { currentBid: 25.00, expectedIncrement: 1.75, expectedNextMin: 26.75 },
    { currentBid: 25.50, expectedIncrement: 2.00, expectedNextMin: 27.50 },
    { currentBid: 30.00, expectedIncrement: 2.00, expectedNextMin: 32.00 },
    { currentBid: 50.00, expectedIncrement: 2.00, expectedNextMin: 52.00 },
  ];

  TEST_MATRIX.forEach(({ currentBid, expectedIncrement, expectedNextMin }) => {
    it(`should correctly calculate increment for ₹${currentBid} Cr -> ₹${expectedNextMin} Cr`, () => {
      expect(getBidIncrement(currentBid)).toBe(expectedIncrement);
      expect(getNextMinimumBid(currentBid)).toBe(expectedNextMin);
    });
  });
});
