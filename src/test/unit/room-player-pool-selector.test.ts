import React, { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomPlayerPoolSelector } from '@/components/rooms/room-player-pool-selector';
import { getPlayersBySetId } from '@/lib/player-sets';

vi.mock('@/lib/player-sets', () => ({
  getPlayersBySetId: vi.fn(),
}));

const players = [
  ['p1', 'Asha', 'BATSMAN', 'A'],
  ['p2', 'Bela', 'BOWLER', 'A'],
  ['p3', 'Chet', 'ALL_ROUNDER', 'B'],
  ['p4', 'Diya', 'WICKET_KEEPER', 'B'],
  ['p5', 'Eshan', 'BATSMAN', 'B'],
  ['p6', 'Farah', 'BOWLER', 'B'],
  ['p7', 'Gopal', 'ALL_ROUNDER', 'C'],
  ['p8', 'Hina', 'WICKET_KEEPER', 'C'],
].map(([id, name, role, category]) => ({
  id,
  name,
  role,
  category,
  player_set_id: 'set-1',
  country: 'India',
  age: null,
  batting_hand: null,
  base_price: 100,
  is_overseas: false,
  image_url: null,
  matches: null,
  runs: null,
  batting_average: null,
  strike_rate: null,
  hundreds: null,
  fifties: null,
  highest_score: null,
  boundaries: null,
  overs: null,
  wickets: null,
  bowling_average: null,
  economy_rate: null,
  bowling_strike_rate: null,
  best_bowling: null,
  three_wicket_hauls: null,
  catches: null,
  stumpings: null,
  created_at: '',
}));

function mountPool() {
  const onChange = vi.fn();
  render(createElement(RoomPlayerPoolSelector, { playerSetId: 'set-1', onChange }));
  return onChange;
}

describe('RoomPlayerPoolSelector', () => {
  beforeEach(() => {
    vi.mocked(getPlayersBySetId).mockResolvedValue(players as never);
  });

  it('preserves Full Set, By Category, and By Role selection and active counts', async () => {
    const onChange = mountPool();
    await screen.findByText('FULL SET (8)');
    await waitFor(() => expect(screen.getByText('8 Players Selected')).toBeInTheDocument());
    expect(onChange).toHaveBeenLastCalledWith(players.map(player => player.id));

    fireEvent.click(screen.getByRole('button', { name: 'BY CATEGORY' }));
    expect(screen.getByText('8 Players Selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Category A (2)' }));
    expect(screen.getByText('6 Players Selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'BY ROLE' }));
    expect(screen.getByText('8 Players Selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'BATSMAN (2)' }));
    expect(screen.getByText('6 Players Selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /FULL SET/ }));
    expect(screen.getByText('8 Players Selected')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(players.map(player => player.id));
  });

  it('keeps the count choices and updates the selected pool size', async () => {
    const onChange = mountPool();
    await screen.findByText('FULL SET (8)');

    const countSelect = screen.getByTestId('pool-count');
    fireEvent.keyDown(countSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(countSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(countSelect, { key: 'Enter' });

    expect(screen.getByText('5 Players Selected')).toBeInTheDocument();
    const selectedIds = onChange.mock.lastCall?.[0] as string[];
    expect(selectedIds).toHaveLength(5);
    expect(new Set(selectedIds).size).toBe(5);
    expect(selectedIds.every(id => players.some(player => player.id === id))).toBe(true);
  });

  it('calls the latest onChange callback when players finish loading', async () => {
    let resolvePlayers!: (value: typeof players) => void;
    vi.mocked(getPlayersBySetId).mockReturnValueOnce(new Promise(resolve => {
      resolvePlayers = resolve;
    }) as never);

    const originalOnChange = vi.fn();
    const latestOnChange = vi.fn();
    const { rerender } = render(createElement(RoomPlayerPoolSelector, {
      playerSetId: 'set-1',
      onChange: originalOnChange,
    }));

    await screen.findByText('Loading player pool...');
    rerender(createElement(RoomPlayerPoolSelector, {
      playerSetId: 'set-1',
      onChange: latestOnChange,
    }));

    resolvePlayers(players);

    await waitFor(() => expect(latestOnChange).toHaveBeenCalledWith(players.map(player => player.id)));
    expect(originalOnChange).not.toHaveBeenCalled();
  });

  it('preserves manual search, role/category filtering, selection and deselection', async () => {
    const onChange = mountPool();
    await screen.findByText('FULL SET (8)');
    fireEvent.click(screen.getByRole('button', { name: 'MANUAL SELECT' }));
    expect(screen.getByText('0 Players Selected')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search players...'), { target: { value: 'Farah' } });
    expect(screen.getByRole('button', { name: /Farah/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Asha/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pool-role-filter'));
    fireEvent.click(screen.getByRole('option', { name: 'BOWLER' }));
    fireEvent.click(screen.getByTestId('pool-category-filter'));
    fireEvent.click(screen.getByRole('option', { name: 'Category B' }));

    fireEvent.click(screen.getByRole('button', { name: /Farah/ }));
    expect(screen.getByText('1 Players Selected')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(['p6']);
    fireEvent.click(screen.getByRole('button', { name: /Farah/ }));
    expect(screen.getByText('0 Players Selected')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
