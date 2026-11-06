import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuctionFeatureStrip } from '@/components/auth/auction-feature-strip';
import { AuctionInfoStrip } from '@/components/rooms/auction-info-strip';
import { AUCTION_BOTS_ENABLED } from '@/lib/feature-flags';

describe('human-only V1 screens', () => {
  it('keeps multiplayer rooms visible while deferring bot opponents', () => {
    expect(AUCTION_BOTS_ENABLED).toBe(false);

    const features = renderToStaticMarkup(<AuctionFeatureStrip />);
    expect(features).toContain('LIVE ROOMS');
    expect(features).toContain('REAL-TIME BIDDING');
    expect(features).not.toContain('BOT OPPONENTS');

    const auctionInfo = renderToStaticMarkup(
      <AuctionInfoStrip
        playerSetName="Test Pool"
        playerCount={5}
        defaultPurseCr={100}
        timerSeconds={15}
        maxSquadSize={15}
        maxOverseas={8}
        botCount={0}
        totalManagers={2}
      />
    );
    expect(auctionInfo).toContain('PLAYER POOL');
    expect(auctionInfo).toContain('TIMER PER LOT');
    expect(auctionInfo).not.toContain('BOT OPPONENTS');
  });
});
