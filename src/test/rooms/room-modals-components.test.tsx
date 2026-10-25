import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomSettingsModal } from '@/components/rooms/room-settings-modal';
import { TeamModal } from '@/components/rooms/team-modal';
import { RoomInviteModal } from '@/components/rooms/room-invite-modal';
import type { Room, Team } from '@/lib/types/room';

describe('Room Modals & Components Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('RoomSettingsModal Component', () => {
    const mockRoom: Room = {
      id: 'room-1',
      name: 'Premier Arena',
      code: 'PREM01',
      host_id: 'user-1',
      status: 'OPEN' as const,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      settings: {
        default_purse: 100,
        timer_duration_seconds: 15,
        max_squad_size: 18,
        min_bid_increment: 20,
        max_overseas: 8,
        player_set_id: null,
        player_order: 'RANDOM',
        bot_count: 0,
      },
    };

    it('renders with initial room settings', () => {
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      expect(screen.getByDisplayValue('Premier Arena')).toBeInTheDocument();
      expect(screen.getByText('₹100 Cr')).toBeInTheDocument();
      expect(screen.getByText('15 SEC')).toBeInTheDocument();
      expect(screen.getByText('18 PLAYERS')).toBeInTheDocument();
    });

    it('normalizes purse from Lakhs (10000) to Crores (100 Cr) without triggering unsaved changes', () => {
      const roomWithLakhs: Room = {
        ...mockRoom,
        settings: {
          ...mockRoom.settings,
          default_purse: 10000,
        },
      };

      const onClose = vi.fn();
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
          initialData={roomWithLakhs}
        />
      );

      expect(screen.getByText('₹100 Cr')).toBeInTheDocument();
      const cancelBtn = screen.getByRole('button', { name: /CANCEL/i });
      fireEvent.click(cancelBtn);
      // Since 10000L = 100Cr, it is clean and closes without unsaved warning
      expect(onClose).toHaveBeenCalled();
    });

    it('toggles bot opponents ON and auto-defaults bot count to 4 if previously 0', () => {
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      const botToggle = screen.getByRole('checkbox');
      expect(botToggle).not.toBeChecked();

      fireEvent.click(botToggle);
      expect(botToggle).toBeChecked();

      // Bot count stepper should now appear with default 4 AI Managers
      expect(screen.getByText('4 AI MANAGERS')).toBeInTheDocument();
    });

    it('clamps stepper values within bounds and updates display', () => {
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      // Timer starts at 15 SEC, step is 5, max is 20
      const incTimer = screen.getByLabelText(/Increase TIMER PER LOT/i);
      expect(incTimer).not.toBeDisabled();

      fireEvent.click(incTimer);
      expect(screen.getByText('20 SEC')).toBeInTheDocument();

      // At max 20, the button should now be disabled
      expect(incTimer).toBeDisabled();

      // Decrease timer
      const decTimer = screen.getByLabelText(/Decrease TIMER PER LOT/i);
      fireEvent.click(decTimer);
      expect(screen.getByText('15 SEC')).toBeInTheDocument();
      fireEvent.click(decTimer);
      expect(screen.getByText('10 SEC')).toBeInTheDocument();
      // At min 10, the decrease button should now be disabled
      expect(decTimer).toBeDisabled();
    });

    it('1. save success persists values and closes the modal', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          initialData={mockRoom}
        />
      );

      const nameInput = screen.getByDisplayValue('Premier Arena');
      fireEvent.change(nameInput, { target: { value: 'Persisted Champions Arena' } });

      const saveBtn = screen.getByRole('button', { name: /SAVE SETTINGS/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Persisted Champions Arena',
          })
        );
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('2. save failure keeps the modal open and displays an error', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('Network connection timeout while persisting room'));
      const onClose = vi.fn();

      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          initialData={mockRoom}
        />
      );

      const nameInput = screen.getByDisplayValue('Premier Arena');
      fireEvent.change(nameInput, { target: { value: 'New Failed Arena' } });

      const saveBtn = screen.getByRole('button', { name: /SAVE SETTINGS/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Network connection timeout while persisting room');
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue('New Failed Arena')).toBeInTheDocument();
    });

    it('3. cancel without changes closes immediately', () => {
      const onClose = vi.fn();
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      const cancelBtn = screen.getByRole('button', { name: /^CANCEL$/i });
      fireEvent.click(cancelBtn);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/UNSAVED CHANGES/i)).not.toBeInTheDocument();
    });

    it('4. X without changes closes immediately', () => {
      const onClose = vi.fn();
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /Close Room Settings/i });
      fireEvent.click(closeBtn);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/UNSAVED CHANGES/i)).not.toBeInTheDocument();
    });

    it('5. cancel with changes opens confirmation and retains edits', () => {
      const onClose = vi.fn();
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      const nameInput = screen.getByDisplayValue('Premier Arena');
      fireEvent.change(nameInput, { target: { value: 'Draft Modified Arena' } });

      const cancelBtn = screen.getByRole('button', { name: /^CANCEL$/i });
      fireEvent.click(cancelBtn);

      // Confirmation appears, modal is NOT closed yet
      expect(screen.getByText(/UNSAVED CHANGES/i)).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      // Click CANCEL inside confirmation to resume editing
      const keepEditingBtn = screen.getByRole('button', { name: /^CANCEL$/i });
      fireEvent.click(keepEditingBtn);

      // Warning disappears, edited value is preserved
      expect(screen.queryByText(/UNSAVED CHANGES/i)).not.toBeInTheDocument();
      expect(screen.getByDisplayValue('Draft Modified Arena')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('6. discard closes both confirmation and Room Settings', () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <RoomSettingsModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      const nameInput = screen.getByDisplayValue('Premier Arena');
      fireEvent.change(nameInput, { target: { value: 'Discarded Name Arena' } });

      const cancelBtn = screen.getByRole('button', { name: /^CANCEL$/i });
      fireEvent.click(cancelBtn);

      expect(screen.getByText(/UNSAVED CHANGES/i)).toBeInTheDocument();

      const discardBtn = screen.getByRole('button', { name: /^DISCARD$/i });
      fireEvent.click(discardBtn);

      expect(onClose).toHaveBeenCalledTimes(1);

      // When parent updates isOpen to false, nothing is rendered
      rerender(
        <RoomSettingsModal
          isOpen={false}
          onClose={onClose}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      expect(screen.queryByText(/ROOM SETTINGS/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/UNSAVED CHANGES/i)).not.toBeInTheDocument();
    });

    it('7. reopening after discard loads persisted values', () => {
      function Wrapper() {
        const [open, setOpen] = React.useState(true);
        return (
          <div>
            <button onClick={() => setOpen(true)}>OPEN MODAL</button>
            <RoomSettingsModal
              isOpen={open}
              onClose={() => setOpen(false)}
              onSubmit={vi.fn()}
              initialData={mockRoom}
            />
          </div>
        );
      }

      render(<Wrapper />);

      // Edit name
      const nameInput = screen.getByDisplayValue('Premier Arena');
      fireEvent.change(nameInput, { target: { value: 'Unsaved Discard Target' } });

      // Click Cancel -> Discard
      fireEvent.click(screen.getByRole('button', { name: /^CANCEL$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^DISCARD$/i }));

      // Modal is closed
      expect(screen.queryByText(/ROOM SETTINGS/i)).not.toBeInTheDocument();

      // Reopen modal
      fireEvent.click(screen.getByRole('button', { name: /OPEN MODAL/i }));

      // Reopened modal must show persisted value ('Premier Arena'), NOT 'Unsaved Discard Target'
      expect(screen.getByDisplayValue('Premier Arena')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Unsaved Discard Target')).not.toBeInTheDocument();
    });

    it('8. reopening after save loads the updated values', async () => {
      function Wrapper() {
        const [open, setOpen] = React.useState(true);
        const [currentRoom, setCurrentRoom] = React.useState<Room>(mockRoom);

        const handleSave = async (data: any) => {
          setCurrentRoom((prev) => ({
            ...prev,
            name: data.name,
            settings: {
              ...prev.settings,
              default_purse: data.default_purse,
              timer_duration_seconds: data.timer_duration_seconds,
            },
          }));
        };

        return (
          <div>
            <button onClick={() => setOpen(true)}>OPEN MODAL</button>
            <RoomSettingsModal
              isOpen={open}
              onClose={() => setOpen(false)}
              onSubmit={handleSave}
              initialData={currentRoom}
            />
          </div>
        );
      }

      render(<Wrapper />);

      const nameInput = screen.getByDisplayValue('Premier Arena');
      fireEvent.change(nameInput, { target: { value: 'Persisted Brand New Arena' } });

      fireEvent.click(screen.getByRole('button', { name: /SAVE SETTINGS/i }));

      await waitFor(() => {
        expect(screen.queryByText(/ROOM SETTINGS/i)).not.toBeInTheDocument();
      });

      // Reopen modal
      fireEvent.click(screen.getByRole('button', { name: /OPEN MODAL/i }));

      // Reopened modal shows persisted values
      expect(screen.getByDisplayValue('Persisted Brand New Arena')).toBeInTheDocument();
    });

    it('9. parent rerenders do not unexpectedly reopen the modal or wipe in-progress edits', () => {
      const { rerender } = render(
        <RoomSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockRoom}
        />
      );

      const nameInput = screen.getByDisplayValue('Premier Arena');
      fireEvent.change(nameInput, { target: { value: 'In Progress Name' } });

      // Simulate background polling rerender with new object reference
      const clonedRoom: Room = {
        ...mockRoom,
        updated_at: new Date().toISOString(),
      };

      rerender(
        <RoomSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={clonedRoom}
        />
      );

      // In-progress edit should NOT be wiped out
      expect(screen.getByDisplayValue('In Progress Name')).toBeInTheDocument();

      // Also verify when closed, parent rerender does not reopen
      rerender(
        <RoomSettingsModal
          isOpen={false}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={clonedRoom}
        />
      );

      expect(screen.queryByText(/ROOM SETTINGS/i)).not.toBeInTheDocument();
    });

    it('10. unauthorized users cannot save settings', () => {
      const onSubmit = vi.fn();
      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={onSubmit}
          initialData={mockRoom}
          isHost={false}
        />
      );

      expect(screen.getByText(/only the room host can modify/i)).toBeInTheDocument();
      const saveBtn = screen.getByRole('button', { name: /SAVE SETTINGS/i });
      expect(saveBtn).toBeDisabled();

      fireEvent.click(saveBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('enforces locked state when auction is not in OPEN status', () => {
      const lockedRoom: Room = {
        ...mockRoom,
        status: 'LOCKED',
      };

      render(
        <RoomSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={lockedRoom}
        />
      );

      expect(screen.getByText(/locked because the auction is not in lobby state/i)).toBeInTheDocument();
      const saveBtn = screen.getByRole('button', { name: /SAVE SETTINGS/i });
      expect(saveBtn).toBeDisabled();
    });
  });

  describe('TeamModal (Edit My Franchise)', () => {
    const mockTeam: Team = {
      id: 'team-1',
      auction_id: 'auction-1',
      name: 'Chennai Super Kings',
      short_name: 'CSK',
      color: '#E4B93F',
      purse: 10000,
      initial_purse: 10000,
      players_bought: 0,
      overseas_count: 0,
      is_bot: false,
      created_at: '2026-01-01T00:00:00Z',
    };

    it('renders with initial franchise data and live preview', () => {
      render(
        <TeamModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockTeam}
        />
      );

      expect(screen.getByDisplayValue('Chennai Super Kings')).toBeInTheDocument();
      expect(screen.getByDisplayValue('CSK')).toBeInTheDocument();

      // Check live preview card shows team info
      const previewTitle = screen.getByText('Chennai Super Kings', { selector: 'h4' });
      expect(previewTitle).toBeInTheDocument();
      expect(screen.getAllByText('CSK').length).toBeGreaterThanOrEqual(1);
    });

    it('automatically uppercases short code on input', () => {
      render(
        <TeamModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockTeam}
        />
      );

      const shortInput = screen.getByDisplayValue('CSK');
      fireEvent.change(shortInput, { target: { value: 'rcb' } });
      expect(shortInput).toHaveValue('RCB');
    });

    it('disables save button if short code is less than 2 characters', async () => {
      render(
        <TeamModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockTeam}
        />
      );

      const shortInput = screen.getByDisplayValue('CSK');
      fireEvent.change(shortInput, { target: { value: 'C' } });

      const saveBtn = screen.getByRole('button', { name: /UPDATE FRANCHISE/i });
      expect(saveBtn).toBeDisabled();
    });

    it('updates color and updates active swatch border immediately', () => {
      render(
        <TeamModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initialData={mockTeam}
        />
      );

      const rcbButton = screen.getByLabelText('Select color #DC2626');
      fireEvent.click(rcbButton);

      // Selected swatch has scale and ring
      expect(rcbButton.className).toContain('ring-[#E4B93F]');
      expect(screen.getAllByText('#DC2626').length).toBeGreaterThanOrEqual(1);
    });

    it('displays server rejection error inline without crashing', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('A team with this short code already exists'));
      render(
        <TeamModal
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={onSubmit}
          initialData={mockTeam}
        />
      );

      const saveBtn = screen.getByRole('button', { name: /UPDATE FRANCHISE/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText('A team with this short code already exists')).toBeInTheDocument();
      });
    });

    it('closes on Escape key press', () => {
      const onClose = vi.fn();
      render(
        <TeamModal
          isOpen={true}
          onClose={onClose}
          onSubmit={vi.fn()}
          initialData={mockTeam}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('RoomInviteModal', () => {
    it('renders room code and canonical invite link', () => {
      render(
        <RoomInviteModal
          isOpen={true}
          onClose={vi.fn()}
          roomCode="KX9P2B"
          roomName="IPL Auction 2026"
        />
      );

      expect(screen.getByText('KX9P2B')).toBeInTheDocument();
      expect(screen.getByText('IPL Auction 2026')).toBeInTheDocument();
      expect(screen.getByDisplayValue(/rooms\/join\?code=KX9P2B/i)).toBeInTheDocument();
    });

    it('copies room code and displays copied feedback', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(
        <RoomInviteModal
          isOpen={true}
          onClose={vi.fn()}
          roomCode="KX9P2B"
        />
      );

      const copyCodeBtn = screen.getByTitle('Copy Room Code');
      fireEvent.click(copyCodeBtn);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith('KX9P2B');
        expect(screen.getByText('COPIED ✓')).toBeInTheDocument();
      });
    });

    it('copies invite link and displays copied feedback', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(
        <RoomInviteModal
          isOpen={true}
          onClose={vi.fn()}
          roomCode="KX9P2B"
        />
      );

      const copyLinkBtn = screen.getByRole('button', { name: /COPY INVITE LINK/i });
      fireEvent.click(copyLinkBtn);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/rooms/join?code=KX9P2B'));
        expect(screen.getByText('LINK COPIED ✓')).toBeInTheDocument();
      });
    });

    it('handles missing room code safely and disables copy actions', () => {
      render(
        <RoomInviteModal
          isOpen={true}
          onClose={vi.fn()}
          roomCode=""
        />
      );

      expect(screen.getByText('CODE UNAVAILABLE')).toBeInTheDocument();
      const copyCodeBtn = screen.getByTitle('Copy Room Code');
      expect(copyCodeBtn).toBeDisabled();

      const copyLinkBtn = screen.getByRole('button', { name: /COPY INVITE LINK/i });
      expect(copyLinkBtn).toBeDisabled();
    });

    it('closes on Escape key press', () => {
      const onClose = vi.fn();
      render(
        <RoomInviteModal
          isOpen={true}
          onClose={onClose}
          roomCode="KX9P2B"
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });
});
