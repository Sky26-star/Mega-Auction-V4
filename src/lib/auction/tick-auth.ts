import { timingSafeEqual } from 'node:crypto';

export const AUCTION_TICK_SECRET_HEADER = 'x-auction-tick-secret';
export const AUCTION_TICK_SECRET_MIN_LENGTH = 32;

export function getConfiguredAuctionTickSecret(): string | null {
  const secret = process.env.AUCTION_TICK_SECRET;
  if (!secret || secret.length < AUCTION_TICK_SECRET_MIN_LENGTH || /\s/.test(secret)) {
    return null;
  }

  return secret;
}

export function hasValidAuctionTickSecret(request: Request, expectedSecret: string): boolean {
  const providedSecret = request.headers.get(AUCTION_TICK_SECRET_HEADER);
  if (!providedSecret) return false;

  const expectedBytes = Buffer.from(expectedSecret, 'utf8');
  const providedBytes = Buffer.from(providedSecret, 'utf8');
  if (expectedBytes.length !== providedBytes.length) return false;

  return timingSafeEqual(expectedBytes, providedBytes);
}
