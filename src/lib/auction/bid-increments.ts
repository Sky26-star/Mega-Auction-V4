// src/lib/auction/bid-increments.ts
// Official Single Source of Truth for Mega Auction Bid Increments

/**
 * Returns the exact bid increment in Crores based on currentBidCr.
 *
 * Rules:
 * - ₹0.00 Cr to ₹3.00 Cr       => ₹0.25 Cr (25 Lakhs)
 * - Above ₹3.00 Cr to ₹6.00 Cr  => ₹0.50 Cr (50 Lakhs)
 * - Above ₹6.00 Cr to ₹10.00 Cr => ₹0.75 Cr (75 Lakhs)
 * - Above ₹10.00 Cr to ₹15.00 Cr => ₹1.00 Cr (1 Crore)
 * - Above ₹15.00 Cr to ₹20.00 Cr => ₹1.50 Cr (1.5 Crores)
 * - Above ₹20.00 Cr to ₹25.00 Cr => ₹1.75 Cr (1.75 Crores)
 * - Above ₹25.00 Cr             => ₹2.00 Cr (2 Crores - No Limit)
 */
export function getBidIncrement(currentBidCr: number): number {
  const bid = Number(currentBidCr.toFixed(2));

  if (bid <= 3.0) {
    return 0.25;
  } else if (bid <= 6.0) {
    return 0.50;
  } else if (bid <= 10.0) {
    return 0.75;
  } else if (bid <= 15.0) {
    return 1.00;
  } else if (bid <= 20.0) {
    return 1.50;
  } else if (bid <= 25.0) {
    return 1.75;
  } else {
    return 2.00;
  }
}

/**
 * Calculates the exact next minimum bid in Crores given currentBidCr.
 */
export function getNextMinimumBid(currentBidCr: number): number {
  const increment = getBidIncrement(currentBidCr);
  return +(currentBidCr + increment).toFixed(2);
}

/**
 * Generates an array of dynamic quick bid increment option values starting from currentBidCr.
 * Example for currentBidCr = 12.50:
 * Returns: [13.50, 14.50, 15.50, 17.00, 18.50]
 */
export function getQuickBidOptions(currentBidCr: number, count: number = 5): number[] {
  const options: number[] = [];
  let runner = currentBidCr;

  for (let i = 0; i < count; i++) {
    runner = getNextMinimumBid(runner);
    options.push(runner);
  }

  return options;
}
