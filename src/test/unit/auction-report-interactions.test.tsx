import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { V3Player, V3Team } from '@/lib/v3-auction-types';
import SquadPage from '@/app/(dashboard)/rooms/[id]/squad/page';
import { AuctionOverview } from '@/components/rooms/v3/stats/AuctionOverview';
import type { V3StatsData } from '@/hooks/useV3Stats';

const mocks = vi.hoisted(() => ({ context: vi.fn(), squad: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'room-ui-test' }) }));
vi.mock('@/components/layout/navbar', () => ({
  Navbar: () => <nav aria-label="Main navigation" />,
}));
vi.mock('@/components/rooms/v3/V3AuctionStateProvider', () => ({
  useV3AuctionContext: mocks.context,
}));
vi.mock('@/hooks/useV3Squad', () => ({ useV3Squad: mocks.squad }));

const teamA: V3Team = {
  id: 'a',
  name: 'Chennai Champions',
  short_name: 'CC',
  purse: 11850,
  initial_purse: 12000,
  players_bought: 2,
  overseas_count: 0,
  is_bot: false,
};
const teamB: V3Team = { ...teamA, id: 'b', name: 'Mumbai Masters' };
const player = (id: string, name: string, role: V3Player['role']): V3Player => ({
  id,
  name,
  role,
  category: 'A',
  country: 'India',
  age: null,
  batting_hand: null,
  base_price: 50,
  is_overseas: false,
  image_url: null,
});

beforeEach(() => {
  mocks.context.mockReturnValue({
    state: { auction: { id: 'auction-a' }, teams: [teamA, teamB] },
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
  mocks.squad.mockReturnValue({
    squadPlayers: [
      {
        lot_id: 'one',
        winning_team_id: 'a',
        winning_bid: 150,
        player: player('one', 'Aaron Finch', 'BATSMAN'),
      },
      {
        lot_id: 'two',
        winning_team_id: 'a',
        winning_bid: 100,
        player: player('two', 'Jasprit Bumrah', 'BOWLER'),
      },
      {
        lot_id: 'three',
        winning_team_id: 'b',
        winning_bid: 125,
        player: player('three', 'Mumbai Batter', 'BATSMAN'),
      },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
});

describe('auction report interactions', () => {
  it('combines role and search filters, and recovers from a no-match result', () => {
    render(<SquadPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Bowlers/ }));
    expect(screen.getByRole('heading', { name: 'Jasprit Bumrah' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Aaron Finch' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Finch' } });
    expect(screen.getByText('No players match your filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Aaron Finch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Jasprit Bumrah' })).toBeInTheDocument();
  });

  it('preserves the selected franchise when realtime updates reorder the teams', () => {
    const { rerender } = render(<SquadPage />);
    fireEvent.change(screen.getByLabelText('Select franchise'), { target: { value: 'b' } });
    expect(screen.getByRole('heading', { name: 'Mumbai Batter' })).toBeInTheDocument();
    mocks.context.mockReturnValue({
      state: { auction: { id: 'auction-a' }, teams: [teamB, teamA] },
      loading: false,
      error: null,
    });
    rerender(<SquadPage />);
    expect(screen.getByLabelText('Select franchise')).toHaveValue('b');
    expect(screen.getByRole('heading', { name: 'Mumbai Batter' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Aaron Finch' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next franchise' }));
    expect(screen.getByLabelText('Select franchise')).toHaveValue('a');
  });

  it('converts stored lakhs consistently across squad and stats money displays', () => {
    const { unmount } = render(<SquadPage />);
    expect(screen.getByText('₹118.50')).toBeInTheDocument();
    expect(screen.getAllByText('₹1.50').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹11850.00')).not.toBeInTheDocument();
    unmount();
    render(
      <AuctionOverview
        stats={
          {
            totalLotsAuctioned: 1,
            totalSold: 1,
            totalUnsold: 0,
            capitalDeployed: 150,
            averageSoldPrice: 150,
            highestBidLot: null,
          } as V3StatsData
        }
      />
    );
    expect(screen.getAllByText('₹1.50')).toHaveLength(2);
  });
});
