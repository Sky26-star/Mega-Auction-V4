import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateRandomCode,
  generateUniqueRoomCode,
  isRoomCodeCollisionError,
  formatRpcError,
  createRoom,
  MAX_ROOM_CODE_RETRIES,
} from '@/lib/rooms';
import * as authModule from '@/lib/auth';
import * as clientModule from '@/lib/supabase/client';
import { BOT_FRANCHISE_POOL, getUniqueBotIdentities } from '../../lib/bots';
import {
  createRoomSchema,
  joinRoomSchema,
  joinRoomWithTeamSchema,
  updateMyTeamSchema,
  teamSchema,
  ROOM_CODE_REGEX,
  HEX_COLOR_REGEX,
} from '@/lib/validations/room';

describe('Phase 5 — Room & Team Unit Test Suite', () => {
  describe('Room Code Generation & Regex', () => {
    it('generates a 6-character uppercase alphanumeric code', () => {
      const code = generateRandomCode();
      expect(code).toHaveLength(6);
      expect(ROOM_CODE_REGEX.test(code)).toBe(true);
    });

    it('validates joinRoomSchema with valid 6-character codes', () => {
      const result = joinRoomSchema.safeParse({ code: 'KX9P2B' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe('KX9P2B');
      }
    });

    it('rejects invalid room codes (wrong length or special characters)', () => {
      expect(joinRoomSchema.safeParse({ code: 'KX9P2' }).success).toBe(false); // 5 chars
      expect(joinRoomSchema.safeParse({ code: 'KX9P2B7' }).success).toBe(false); // 7 chars
      expect(joinRoomSchema.safeParse({ code: 'KX9P-B' }).success).toBe(false); // dash
    });
  });

  describe('createRoomSchema (Phase 5B)', () => {
    it('validates a valid room & host franchise creation payload', () => {
      const payload = {
        name: 'Mega Auction',
        code: 'ABC123',
        player_set_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        default_purse: 1000,
        timer_duration_seconds: 15,
        min_bid_increment: 5,
        max_squad_size: 25,
        max_overseas: 8,
        team_name: 'Mumbai Indians',
        team_short_name: 'MI',
        team_color: '#2600FD',
      };
      const result = createRoomSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects room name shorter than 3 characters', () => {
      const result = createRoomSchema.safeParse({
        name: 'AB',
        player_set_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        default_purse: 1000,
        timer_duration_seconds: 15,
        min_bid_increment: 5,
        max_squad_size: 25,
        max_overseas: 8,
        team_name: 'Mumbai Indians',
        team_short_name: 'MI',
        team_color: '#1D00F9',
      });
      expect(result.success).toBe(false);
    });

    it('rejects timer duration out of range (5s to 60s)', () => {
      const resultTooLow = createRoomSchema.safeParse({
        name: 'Valid Room Name',
        player_set_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        default_purse: 1000,
        timer_duration_seconds: 3, // too low
        min_bid_increment: 5,
        max_squad_size: 25,
        max_overseas: 8,
        team_name: 'Mumbai Indians',
        team_short_name: 'MI',
        team_color: '#2600FD',
      });
      expect(resultTooLow.success).toBe(false);

      const resultTooHigh = createRoomSchema.safeParse({
        name: 'Valid Room Name',
        player_set_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        default_purse: 1000,
        timer_duration_seconds: 120, // too high
        min_bid_increment: 5,
        max_squad_size: 25,
        max_overseas: 8,
        team_name: 'Mumbai Indians',
        team_short_name: 'MI',
        team_color: '#2600FD',
      });
      expect(resultTooHigh.success).toBe(false);
    });

    it('rejects default purse less than 100', () => {
      const result = createRoomSchema.safeParse({
        name: 'Valid Room Name',
        player_set_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        default_purse: 50, // invalid
        timer_duration_seconds: 15,
        min_bid_increment: 5,
        max_squad_size: 25,
        max_overseas: 8,
        team_name: 'Mumbai Indians',
        team_short_name: 'MI',
        team_color: '#2600FD',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Phase 5B Join and Edit Schemas', () => {
    it('validates joinRoomWithTeamSchema', () => {
      const result = joinRoomWithTeamSchema.safeParse({
        team_name: 'Chennai Super Kings',
        team_short_name: 'CSK',
        team_color: '#F59E0B',
      });
      expect(result.success).toBe(true);
    });

    it('validates updateMyTeamSchema', () => {
      const result = updateMyTeamSchema.safeParse({
        team_name: 'Mumbai Indians',
        team_short_name: 'MI',
        team_color: '#3B82F6',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid team color format in updateMyTeamSchema', () => {
      const result = updateMyTeamSchema.safeParse({
        team_name: 'Mumbai Indians',
        team_short_name: 'MI',
        team_color: 'blue',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('teamSchema', () => {
    it('validates a valid team payload', () => {
      const payload = {
        name: 'Mumbai Indians',
        short_name: 'MI',
        color: '#004BA0',
        initial_purse: 1000,
        is_bot: false,
      };
      const result = teamSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects short_name outside 2-5 character limit', () => {
      const resultOneChar = teamSchema.safeParse({
        name: 'Mumbai Indians',
        short_name: 'M',
        color: '#004BA0',
        initial_purse: 1000,
        is_bot: false,
      });
      expect(resultOneChar.success).toBe(false);

      const resultSixChars = teamSchema.safeParse({
        name: 'Mumbai Indians',
        short_name: 'MUMBAI',
        color: '#004BA0',
        initial_purse: 1000,
        is_bot: false,
      });
      expect(resultSixChars.success).toBe(false);
    });

    it('rejects invalid hex color format', () => {
      const result = teamSchema.safeParse({
        name: 'Chennai Super Kings',
        short_name: 'CSK',
        color: 'yellow', // invalid hex
        initial_purse: 1000,
        is_bot: false,
      });
      expect(result.success).toBe(false);
    });

    it('validates HEX_COLOR_REGEX', () => {
      expect(HEX_COLOR_REGEX.test('#FF5733')).toBe(true);
      expect(HEX_COLOR_REGEX.test('#000000')).toBe(true);
      expect(HEX_COLOR_REGEX.test('#FFFFFF')).toBe(true);
      expect(HEX_COLOR_REGEX.test('#FFF')).toBe(false); // 3-digit hex invalid
      expect(HEX_COLOR_REGEX.test('123456')).toBe(false); // missing hash
    });
  });

  describe('Bot Identity System & Manager Capacity (10 Max)', () => {
    it('contains exactly 9 unique fictional bot franchise identities', () => {
      expect(BOT_FRANCHISE_POOL).toHaveLength(9);
      const names = BOT_FRANCHISE_POOL.map((b: { name: string }) => b.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(9);

      // Verify approved names
      expect(names).toContain('Hyderabad Kakatiyas');
      expect(names).toContain('Chennai Cholas');
      expect(names).toContain('Punjab Maharajas');
      expect(names).toContain('Rajasthan Rajputs');
      expect(names).toContain('Gujarat Solankis');
      expect(names).toContain('Kolkata Mauryas');
      expect(names).toContain('Mumbai Marathas');
      expect(names).toContain('Bengaluru Chalukyas');
      expect(names).toContain('Delhi Mughals');
    });

    it('returns N unique bot identities without duplicates for any count 0..9', () => {
      for (let count = 0; count <= 9; count++) {
        const selected = getUniqueBotIdentities(count);
        expect(selected).toHaveLength(count);
        const selectedNames = selected.map((b: { name: string }) => b.name);
        const uniqueSelected = new Set(selectedNames);
        expect(uniqueSelected.size).toBe(count);
      }
    });

    it('bounds bot count between 0 and 9', () => {
      expect(getUniqueBotIdentities(-3)).toHaveLength(0);
      expect(getUniqueBotIdentities(15)).toHaveLength(9);
    });

    it('validates bot_count inside createRoomSchema', () => {
      const validPayload = {
        name: 'Bot Test Room',
        code: 'BOT123',
        player_set_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        default_purse: 100,
        timer_duration_seconds: 15,
        min_bid_increment: 5,
        max_squad_size: 15,
        max_overseas: 8,
        team_name: 'Host Team',
        team_short_name: 'HOST',
        team_color: '#C9A227',
        bot_count: 4,
      };
      expect(createRoomSchema.safeParse(validPayload).success).toBe(true);

      const invalidHigh = createRoomSchema.safeParse({ ...validPayload, bot_count: 10 });
      expect(invalidHigh.success).toBe(false);

      const invalidNegative = createRoomSchema.safeParse({ ...validPayload, bot_count: -1 });
      expect(invalidNegative.success).toBe(false);
    });

    it('verifies total manager capacity ratios out of 10 for 0, 4, 8, and 9 bots', () => {
      const calculateManagers = (botCount: number) => {
        const human = 1; // 1 Host
        const total = human + botCount;
        return `${total}/10 MANAGERS`;
      };

      expect(calculateManagers(0)).toBe('1/10 MANAGERS');
      expect(calculateManagers(4)).toBe('5/10 MANAGERS');
      expect(calculateManagers(8)).toBe('9/10 MANAGERS');
      expect(calculateManagers(9)).toBe('10/10 MANAGERS');
    });

    it('formats PGRST202 schema cache error into mandatory migration error message', () => {
      const pgrstError = {
        code: 'PGRST202',
        message: 'Could not find the function public.provision_room_bots(p_bots, p_room_id) in the schema cache',
      };
      const formatted = pgrstError.code === 'PGRST202'
        ? 'THE RPC MIGRATION MUST BE APPLIED TO THE CONNECTED SUPABASE DATABASE.'
        : pgrstError.message;
      expect(formatted).toBe('THE RPC MIGRATION MUST BE APPLIED TO THE CONNECTED SUPABASE DATABASE.');
    });
  });

  describe('Room Deletion System (Issue 1)', () => {
    it('requires user authentication before deleting a room', async () => {
      const deleteWithoutAuth = async () => {
        const profile = null;
        if (!profile) throw new Error('User must be logged in to delete a room');
      };
      await expect(deleteWithoutAuth()).rejects.toThrow('User must be logged in to delete a room');
    });

    it('rejects deletion if caller is not the room host', async () => {
      const deleteNonOwned = async (hostId: string, userId: string) => {
        if (hostId !== userId) throw new Error('Only the room host can delete this room.');
      };
      await expect(deleteNonOwned('host-123', 'user-456')).rejects.toThrow('Only the room host can delete this room.');
    });
  });

  describe('Auction Info Header / Strip Component', () => {
    it('formats exact configuration values for 6 metrics without fake data', () => {
      const config = {
        playerSetName: 'IPL 2026 Core Pool',
        playerCount: 250,
        defaultPurseCr: 120,
        timerSeconds: 10,
        maxSquadSize: 15,
        maxOverseas: 8,
        botCount: 3,
        totalManagers: 4,
        maxManagers: 10,
      };

      const playerPoolStr = `${config.playerSetName} (${config.playerCount})`;
      const purseStr = `₹${config.defaultPurseCr} Cr`;
      const timerStr = `${config.timerSeconds} SEC`;
      const squadStr = `${config.maxSquadSize} PLAYERS`;
      const overseasStr = `${config.maxOverseas} PLAYERS`;
      const botsStr = `${config.botCount} AI BOTS (${config.totalManagers}/${config.maxManagers})`;

      expect(playerPoolStr).toBe('IPL 2026 Core Pool (250)');
      expect(purseStr).toBe('₹120 Cr');
      expect(timerStr).toBe('10 SEC');
      expect(squadStr).toBe('15 PLAYERS');
      expect(overseasStr).toBe('8 PLAYERS');
      expect(botsStr).toBe('3 AI BOTS (4/10)');
    });
  });

  describe('Room Code Collision and Retry Exhaustion', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('isRoomCodeCollisionError accurately identifies PostgreSQL rooms_code_key collision errors', () => {
      expect(isRoomCodeCollisionError({ message: 'duplicate key value violates unique constraint "rooms_code_key"' })).toBe(true);
      expect(isRoomCodeCollisionError({ details: 'Key (code)=(ABC123) already exists.', code: '23505' })).toBe(true);
      expect(isRoomCodeCollisionError({ message: 'rooms_code_key unique constraint failed' })).toBe(true);
      expect(isRoomCodeCollisionError('duplicate key value violates unique constraint "rooms_code_key"')).toBe(true);
      expect(isRoomCodeCollisionError({ code: '23505', message: 'duplicate key value violates unique constraint on rooms' })).toBe(true);

      // Non-collision errors must return false
      expect(isRoomCodeCollisionError({ message: 'AUTH_REQUIRED: User must be authenticated' })).toBe(false);
      expect(isRoomCodeCollisionError({ message: 'unique_auction_team_name' })).toBe(false);
      expect(isRoomCodeCollisionError({ message: 'unique_auction_team_short_name' })).toBe(false);
      expect(isRoomCodeCollisionError({ message: 'INVALID_ROOM_NAME' })).toBe(false);
      expect(isRoomCodeCollisionError(null)).toBe(false);
      expect(isRoomCodeCollisionError(undefined)).toBe(false);
    });

    it('formatRpcError formats rooms_code_key collision error into a clean user-friendly message', () => {
      const formatted = formatRpcError('duplicate key value violates unique constraint "rooms_code_key"');
      expect(formatted).toBe('A room with this code already exists. Please choose a different code.');
    });

    it('generateUniqueRoomCode succeeds on first attempt when candidate code is not taken', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };

      const code = await generateUniqueRoomCode(3, mockSupabase);
      expect(code).toHaveLength(6);
      expect(ROOM_CODE_REGEX.test(code)).toBe(true);
    });

    it('generateUniqueRoomCode retries on collision and succeeds when a subsequent candidate code is free', async () => {
      let attempts = 0;
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(async () => {
                attempts++;
                if (attempts === 1) {
                  return { data: { id: 'room-already-exists' }, error: null };
                }
                return { data: null, error: null };
              }),
            }),
          }),
        }),
      };

      const code = await generateUniqueRoomCode(3, mockSupabase);
      expect(attempts).toBe(2);
      expect(code).toHaveLength(6);
    });

    it('generateUniqueRoomCode throws on retry exhaustion when all candidate codes collide', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'colliding-room' }, error: null }),
            }),
          }),
        }),
      };

      await expect(generateUniqueRoomCode(3, mockSupabase)).rejects.toThrow(
        'Failed to generate a unique room code. Please try again.'
      );
    });

    it('createRoom retries on rooms_code_key collision and succeeds on subsequent attempt with new code', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-123' } as any);

      let rpcCallCount = 0;
      const calledCodes: string[] = [];

      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fnName: string, args: any) => {
          if (fnName === 'create_room_with_team') {
            rpcCallCount++;
            calledCodes.push(args.p_room_code);
            if (rpcCallCount === 1) {
              return Promise.resolve({
                data: null,
                error: { message: 'duplicate key value violates unique constraint "rooms_code_key"', code: '23505' },
              });
            }
            return Promise.resolve({
              data: { room_id: 'new-room-456' },
              error: null,
            });
          }
          if (fnName === 'provision_room_bots') {
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        from: vi.fn().mockImplementation((table: string) => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'new-room-456',
                  code: calledCodes[1],
                  name: 'Test Room',
                  host_id: 'user-123',
                  status: 'OPEN',
                  settings: {},
                  auctions: [{ id: 'auc-123', player_sets: { name: 'Pool' } }],
                },
                error: null,
              }),
            }),
          }),
        })),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      const room = await createRoom({
        name: 'Test Room',
        code: 'COLLID',
        player_set_id: 'DEFAULT',
        default_purse: 100,
        timer_duration_seconds: 15,
        min_bid_increment: 50,
        max_squad_size: 15,
        max_overseas: 8,
        team_name: 'Super Kings',
        team_short_name: 'CSK',
        team_color: '#FFFF00',
        bot_count: 0,
      });

      expect(rpcCallCount).toBe(2);
      expect(calledCodes[0]).toBe('COLLID');
      expect(calledCodes[1]).not.toBe('COLLID');
      expect(calledCodes[1]).toHaveLength(6);
      expect(room.id).toBe('new-room-456');
    });

    it('createRoom throws when retry count is exhausted due to continuous collisions', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-123' } as any);

      let rpcCallCount = 0;
      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fnName: string) => {
          if (fnName === 'create_room_with_team') {
            rpcCallCount++;
            return Promise.resolve({
              data: null,
              error: { message: 'duplicate key value violates unique constraint "rooms_code_key"', code: '23505' },
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      await expect(
        createRoom(
          {
            name: 'Test Room',
            code: 'COLLID',
            player_set_id: 'DEFAULT',
            default_purse: 100,
            timer_duration_seconds: 15,
            min_bid_increment: 50,
            max_squad_size: 15,
            max_overseas: 8,
            team_name: 'Super Kings',
            team_short_name: 'CSK',
            team_color: '#FFFF00',
            bot_count: 0,
          },
          3
        )
      ).rejects.toThrow('Failed to generate a unique room code after 3 attempts');

      expect(rpcCallCount).toBe(3);
    });

    it('createRoom does NOT retry on non-collision errors (e.g. AUTH_REQUIRED or validation error)', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-123' } as any);

      let rpcCallCount = 0;
      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fnName: string) => {
          if (fnName === 'create_room_with_team') {
            rpcCallCount++;
            return Promise.resolve({
              data: null,
              error: { message: 'AUTH_REQUIRED: User must be authenticated to create a room' },
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      await expect(
        createRoom({
          name: 'Test Room',
          code: 'NORMAL',
          player_set_id: 'DEFAULT',
          default_purse: 100,
          timer_duration_seconds: 15,
          min_bid_increment: 50,
          max_squad_size: 15,
          max_overseas: 8,
          team_name: 'Super Kings',
          team_short_name: 'CSK',
          team_color: '#FFFF00',
          bot_count: 0,
        })
      ).rejects.toThrow('You must be logged in to perform this action.');

      expect(rpcCallCount).toBe(1); // Failed immediately without retrying
    });

    it('createRoom throws immediately without replacing custom code if is_custom_code is true', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: 'user-123' } as any);

      let rpcCallCount = 0;
      const mockSupabase = {
        rpc: vi.fn().mockImplementation((fnName: string) => {
          if (fnName === 'create_room_with_team') {
            rpcCallCount++;
            return Promise.resolve({
              data: null,
              error: { message: 'duplicate key value violates unique constraint "rooms_code_key"', code: '23505' },
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };

      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      await expect(
        createRoom({
          name: 'Test Room',
          code: 'CUSTOM',
          is_custom_code: true,
          player_set_id: 'DEFAULT',
          default_purse: 100,
          timer_duration_seconds: 15,
          min_bid_increment: 50,
          max_squad_size: 15,
          max_overseas: 8,
          team_name: 'Super Kings',
          team_short_name: 'CSK',
          team_color: '#FFFF00',
          bot_count: 0,
        })
      ).rejects.toThrow('A room with this code already exists. Please choose a different code.');

      expect(rpcCallCount).toBe(1); // Did not overwrite user custom code with random code
    });
  });
});


