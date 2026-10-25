import React, { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayerSetCombobox, type PlayerSetOption } from '@/components/rooms/player-set-combobox';

const options: PlayerSetOption[] = [
  { id: 'DEFAULT', name: 'Official IPL 2026 Dataset', playerCount: 202, typeLabel: 'Default pool' },
  { id: 'public-set-id', name: 'Public Cricket Set', playerCount: 84, typeLabel: 'Public pool' },
  { id: 'private-set-id', name: 'Private Cricket Set', playerCount: 36, typeLabel: 'Private pool' },
];

const combobox = (value: string, onValueChange: (next: string) => void) =>
  createElement(
    React.Fragment,
    null,
    createElement('label', { id: 'player-set-label', htmlFor: 'player-set-select' }, 'Select Auction Player Set'),
    createElement(PlayerSetCombobox, { value, options, onValueChange })
  );

describe('PlayerSetCombobox', () => {
  it.each(options)('preserves the selected ID for $name', option => {
    const onValueChange = vi.fn();
    const { rerender } = render(combobox('DEFAULT', onValueChange));

    const input = screen.getByRole('combobox', { name: 'Select Auction Player Set' });
    fireEvent.focus(input);
    const optionRow = screen.getByRole('option', { name: new RegExp(option.name) });
    expect(optionRow).toHaveTextContent(`${option.playerCount} players`);
    expect(optionRow).toHaveTextContent(option.typeLabel);
    fireEvent.click(optionRow);

    expect(onValueChange).toHaveBeenCalledWith(option.id);

    rerender(combobox(option.id, onValueChange));
    expect(input).toHaveValue(option.name);
  });

  it('filters by dataset name and selects the active result with the keyboard', () => {
    const onValueChange = vi.fn();
    render(combobox('DEFAULT', onValueChange));

    const input = screen.getByRole('combobox', { name: 'Select Auction Player Set' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Private Cricket' } });

    expect(screen.getByRole('option', { name: /Private Cricket Set/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Public Cricket Set/ })).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('private-set-id');
  });
});
