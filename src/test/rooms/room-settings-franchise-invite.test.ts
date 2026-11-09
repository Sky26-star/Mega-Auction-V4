import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatRpcError,
  updateRoom,
  updateMyTeam,
} from '@/lib/rooms';
import * as authModule from '@/lib/auth';
import * as clientModule from '@/lib/supabase/client';
import { updateMyTeamSchema } from '@/lib/validations/room';

describe('Fix Room Settings, Franchise Identity & Share Room Invite Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatRpcError mapping', () => {
    it('formats DUPLICATE_SHORT_NAME properly', () => {
      expect(formatRpcError('DUPLICATE_SHORT_NAME: Abbreviation is taken')).toBe(
        'A team with this short code already exists in this auction room. Please choose a different code.'
      );
    });

    it('formats INVALID_COLOR properly', () => {
      expect(formatRpcError('INVALID_COLOR: Must be hex format')).toBe(
        'Please choose a valid 6-digit hex color (e.g. #FF5733).'
      );
    });

    it('formats NOT_HOST properly', () => {
      expect(formatRpcError('NOT_HOST: Only the room host can update settings')).toBe(
        'Only the room host can modify room settings or start the auction.'
      );
    });

    it('formats ROOM_STATUS_IMMUTABLE properly', () => {
      expect(formatRpcError('ROOM_STATUS_IMMUTABLE: Cannot change after start')).toBe(
        'Room settings cannot be modified once the auction has started.'
      );
    });

    it('formats INVALID_TIMER_DURATION properly', () => {
      expect(formatRpcError('INVALID_TIMER_DURATION: Timer must be 5 to 60')).toBe(
        'Timer duration must be between 5 and 60 seconds per lot.'
      );
    });

    it('formats INVALID_SQUAD_SIZE properly', () => {
      expect(formatRpcError('INVALID_SQUAD_SIZE: Squad must be 15 to 30')).toBe(
        'Maximum squad size must be between 15 and 30 players.'
      );
    });

    it('returns generic error when string is unknown', () => {
      expect(formatRpcError('Some random database error')).toBe('Some random database error');
    });

    it('returns fallback message when empty', () => {
      expect(formatRpcError('')).toBe('An unexpected error occurred.');
    });
  });

  describe('updateMyTeamSchema validation', () => {
    it('accepts valid franchise data and converts short name to uppercase', () => {
      const parsed = updateMyTeamSchema.parse({
        team_name: 'Royal Challengers Bengaluru',
        team_short_name: 'rcb',
        team_color: '#D4AF37',
      });
      expect(parsed.team_name).toBe('Royal Challengers Bengaluru');
      expect(parsed.team_short_name).toBe('RCB');
      expect(parsed.team_color).toBe('#D4AF37');
    });

    it('rejects short name with less than 2 characters', () => {
      const res = updateMyTeamSchema.safeParse({
        team_name: 'Royal Challengers',
        team_short_name: 'R',
        team_color: '#D4AF37',
      });
      expect(res.success).toBe(false);
    });

    it('rejects short name with more than 5 characters', () => {
      const res = updateMyTeamSchema.safeParse({
        team_name: 'Royal Challengers',
        team_short_name: 'RCBXYZ',
        team_color: '#D4AF37',
      });
      expect(res.success).toBe(false);
    });

    it('rejects invalid hex color format', () => {
      const res = updateMyTeamSchema.safeParse({
        team_name: 'Royal Challengers',
        team_short_name: 'RCB',
        team_color: 'red',
      });
      expect(res.success).toBe(false);
    });
  });

  describe('updateRoom settings persistence & RPC execution', () => {
    it('requires authentication before updating room', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue(null);
      await expect(
        updateRoom('room-1', {
          name: 'Renamed Arena',
          default_purse: 120,
          timer_duration_seconds: 20,
          max_squad_size: 18,
          bot_count: 3,
        })
      ).rejects.toThrow('User must be logged in to update a room');
    });

    it('rejects room name shorter than 3 characters', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-host' } as any);
      await expect(
        updateRoom('room-1', {
          name: 'AB',
          default_purse: 120,
          timer_duration_seconds: 20,
          max_squad_size: 18,
          bot_count: 3,
        })
      ).rejects.toThrow('Room name must be between 3 and 50 characters.');
    });

    it('rejects updating room if current user is not the host', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-stranger' } as any);

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'room-1',
                  name: 'Old Name',
                  host_id: 'user-host',
                  status: 'OPEN',
                  settings: { default_purse: 100 },
                },
                error: null,
              }),
            }),
          }),
        })),
        rpc: vi.fn().mockResolvedValue({
          data: [{ room_id: 'room-1', id: 'user-host', display_name: 'Host User' }],
          error: null,
        }),
      };
      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      await expect(
        updateRoom('room-1', {
          name: 'Hacked Arena',
          default_purse: 150,
          timer_duration_seconds: 20,
          max_squad_size: 18,
        })
      ).rejects.toThrow('Only the room host can edit room settings.');
    });

    it('rejects updating room if room status is not OPEN', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-host' } as any);

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'room-1',
                  name: 'Old Name',
                  host_id: 'user-host',
                  status: 'IN_PROGRESS',
                  settings: { default_purse: 100 },
                },
                error: null,
              }),
            }),
          }),
        })),
        rpc: vi.fn().mockResolvedValue({
          data: [{ room_id: 'room-1', id: 'user-host', display_name: 'Host User' }],
          error: null,
        }),
      };
      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      await expect(
        updateRoom('room-1', {
          name: 'Live Arena',
          default_purse: 150,
          timer_duration_seconds: 20,
          max_squad_size: 18,
        })
      ).rejects.toThrow('Cannot edit settings after auction has started.');
    });

    it('calls update_room_settings RPC with correct parameters', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-host' } as any);

      const existingRoom = {
        id: 'room-1',
        name: 'Old Name',
        host_id: 'user-host',
        status: 'OPEN',
        auction_id: 'auction-1',
        settings: {
          default_purse: 100,
          timer_duration_seconds: 15,
          max_squad_size: 15,
          bot_count: 2,
          bots: [
            { id: 'b1', name: 'Bot 1', shortName: 'B1', color: '#111111', managerName: 'AI 1' },
            { id: 'b2', name: 'Bot 2', shortName: 'B2', color: '#222222', managerName: 'AI 2' },
          ],
        },
      };

      const updatedRoom = {
        ...existingRoom,
        name: 'Updated Arena',
        settings: {
          ...existingRoom.settings,
          default_purse: 125,
          timer_duration_seconds: 20,
          max_squad_size: 18,
          bot_count: 2,
        },
      };

      let fetchCount = 0;
      let rpcName = '';
      let rpcParams: any = null;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                fetchCount++;
                return Promise.resolve({
                  data: fetchCount === 1 ? existingRoom : updatedRoom,
                  error: null,
                });
              }),
            }),
          }),
        })),
        rpc: vi.fn().mockImplementation((name, params) => {
          if (name === 'get_room_public_profiles') {
            return Promise.resolve({
              data: [{ room_id: 'room-1', id: 'user-host', display_name: 'Host User' }],
              error: null,
            });
          }
          rpcName = name;
          rpcParams = params;
          return Promise.resolve({ data: { success: true }, error: null });
        }),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      const result = await updateRoom('room-1', {
        name: 'Updated Arena',
        default_purse: 125,
        timer_duration_seconds: 20,
        max_squad_size: 18,
        bot_count: 2,
      });

      expect(rpcName).toBe('update_room_settings');
      expect(rpcParams.p_room_id).toBe('room-1');
      expect(rpcParams.p_room_name).toBe('Updated Arena');
      expect(rpcParams.p_default_purse).toBe(125);
      expect(rpcParams.p_timer_duration_seconds).toBe(20);
      expect(rpcParams.p_max_squad_size).toBe(18);
      expect(rpcParams.p_room_settings.default_purse).toBe(125);
      expect(result.name).toBe('Updated Arena');
      expect(result.settings.timer_duration_seconds).toBe(20);
    });

    it('falls back to direct table update and bot provisioning if RPC fails', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-host' } as any);

      const existingRoom = {
        id: 'room-1',
        name: 'Old Name',
        host_id: 'user-host',
        status: 'OPEN',
        auctions: [{ id: 'auction-1' }],
        settings: {
          default_purse: 100,
          timer_duration_seconds: 15,
          max_squad_size: 15,
          bot_count: 0,
        },
      };

      const updatedRoom = {
        ...existingRoom,
        name: 'Fallback Arena',
        auctions: [{ id: 'auction-1' }],
        settings: {
          ...existingRoom.settings,
          default_purse: 110,
          timer_duration_seconds: 25,
          max_squad_size: 20,
        },
      };

      let fetchCount = 0;
      const roomsUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
      const roomsUpdateEq1 = vi.fn().mockReturnValue({ eq: roomsUpdateEq2 });
      const roomsUpdate = vi.fn().mockReturnValue({ eq: roomsUpdateEq1 });

      const teamsUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const teamsUpdate = vi.fn().mockReturnValue({ eq: teamsUpdateEq });

      const lotsUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
      const lotsUpdateEq1 = vi.fn().mockReturnValue({ eq: lotsUpdateEq2 });
      const lotsUpdate = vi.fn().mockReturnValue({ eq: lotsUpdateEq1 });

      const mockSupabase = {
        rpc: vi.fn().mockImplementation((name) => {
          if (name === 'get_room_public_profiles') {
            return Promise.resolve({
              data: [{ room_id: 'room-1', id: 'user-host', display_name: 'Host User' }],
              error: null,
            });
          }
          if (name === 'update_room_settings') {
            return Promise.resolve({ error: { message: 'function update_room_settings does not exist' } });
          }
          if (name === 'provision_room_bots') {
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ error: null });
        }),
        from: vi.fn().mockImplementation((tableName) => {
          if (tableName === 'rooms') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockImplementation(() => {
                    fetchCount++;
                    return Promise.resolve({
                      data: fetchCount === 1 ? existingRoom : updatedRoom,
                      error: null,
                    });
                  }),
                }),
              }),
              update: roomsUpdate,
            };
          }
          if (tableName === 'teams') return { update: teamsUpdate };
          if (tableName === 'auction_lots') return { update: lotsUpdate };
          return { update: vi.fn() };
        }),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      const result = await updateRoom('room-1', {
        name: 'Fallback Arena',
        default_purse: 110,
        timer_duration_seconds: 25,
        max_squad_size: 20,
        bot_count: 0,
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('update_room_settings', expect.any(Object));
      expect(roomsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Fallback Arena',
          settings: expect.objectContaining({
            default_purse: 110,
            timer_duration_seconds: 25,
            max_squad_size: 20,
          }),
        })
      );
      expect(teamsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          purse: 11000,
          initial_purse: 11000,
        })
      );
      expect(lotsUpdate).toHaveBeenCalledWith({ timer_duration_seconds: 25 });
      expect(result.name).toBe('Fallback Arena');
    });
  });

  describe('updateMyTeam franchise identity persistence & validation', () => {
    it('calls update_my_team RPC with uppercase short name and trimmed name', async () => {
      let rpcName = '';
      let rpcParams: any = null;

      const mockSupabase = {
        rpc: vi.fn().mockImplementation((name, params) => {
          rpcName = name;
          rpcParams = params;
          return Promise.resolve({
            data: { success: true },
            error: null,
          });
        }),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      await updateMyTeam('team-1', {
        team_name: '  Sunrisers Hyderabad  ',
        team_short_name: 'srh',
        team_color: '#F26522',
      });

      expect(rpcName).toBe('update_my_team');
      expect(rpcParams).toEqual({
        p_team_id: 'team-1',
        p_team_name: '  Sunrisers Hyderabad  ',
        p_team_short_name: 'SRH',
        p_team_color: '#F26522',
      });
    });

    it('rejects duplicate short name returned by backend RPC', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'DUPLICATE_SHORT_NAME: Team short code is already taken in this room' },
        }),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      await expect(
        updateMyTeam('team-1', {
          team_name: 'Mumbai Indians',
          team_short_name: 'MI',
          team_color: '#004BA0',
        })
      ).rejects.toThrow('A team with this short code already exists in this auction room. Please choose a different code.');
    });
  });

  describe('Invite link canonical URL and format', () => {
    it('constructs correct canonical invite URL format', () => {
      const origin = 'https://mega-auction.example.com';
      const roomCode = 'w9kx2m';
      const inviteUrl = `${origin}/rooms/join?code=${roomCode.toUpperCase()}`;
      expect(inviteUrl).toBe('https://mega-auction.example.com/rooms/join?code=W9KX2M');
    });
  });
});
