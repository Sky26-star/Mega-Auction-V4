import type { Metadata } from 'next';
import { AuthProvider } from '@/components/providers/auth-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mega Auction Arena',
  description: 'Live cricket auctions, franchise squads, and auction insights.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body><AuthProvider>{children}</AuthProvider></body></html>;
}
