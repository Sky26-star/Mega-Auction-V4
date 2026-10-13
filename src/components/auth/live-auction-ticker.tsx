'use client';

// src/components/auth/live-auction-ticker.tsx
// Legacy wrapper component re-exporting LiveAuctionPreview for backward compatibility
import { LiveAuctionPreview } from './live-auction-preview';

export function LiveAuctionTicker() {
  return <LiveAuctionPreview />;
}
