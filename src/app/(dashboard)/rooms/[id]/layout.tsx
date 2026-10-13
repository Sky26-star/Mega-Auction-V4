import { V3AuctionStateProvider } from '@/components/rooms/v3/V3AuctionStateProvider';
import { use } from 'react';

export default function RoomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  return (
    <V3AuctionStateProvider roomId={resolvedParams.id}>
      {children}
    </V3AuctionStateProvider>
  );
}
