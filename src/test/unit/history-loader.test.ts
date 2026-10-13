// src/test/unit/history-loader.test.ts
// Unit Tests for Authoritative History Loaders (17D & 17E)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadPlayerAuctionHistory,
  loadAuctionHistoryRecord,
  loadUserCompletedAuctionsList,
} from '@/lib/history/loader';
import * as authModule from '@/lib/auth';
import * as clientModule from '@/lib/supabase/client';

describe('Authoritative History Loaders (17D & 17E)', () => {
  const mockUserId = 'usr-test-123';
  const mockRoomId = 'room-abc-789';
  const mockPlayerId = 'player-xyz-456';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadPlayerAuctionHistory', () => {
    it('returns AUTH_REQUIRED when user is unauthenticated', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue(null as any);

      const { data, error } = await loadPlayerAuctionHistory(mockRoomId, mockPlayerId);
      expect(data).toBeNull();
      expect(error).toContain('AUTH_REQUIRED');
    });

    it('returns ROOM_NOT_FOUND when room does not exist', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: mockUserId } as any);

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      const { data, error } = await loadPlayerAuctionHistory(mockRoomId, mockPlayerId);
      expect(data).toBeNull();
      expect(error).toContain('ROOM_NOT_FOUND');
    });

    it('returns UNAUTHORIZED when caller is neither host nor participant', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: mockUserId } as any);

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'rooms') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: mockRoomId, code: 'R1', name: 'Room 1', host_id: 'other-host' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'room_participants') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      const { data, error } = await loadPlayerAuctionHistory(mockRoomId, mockPlayerId);
      expect(data).toBeNull();
      expect(error).toContain('UNAUTHORIZED');
    });
  });

  describe('loadAuctionHistoryRecord', () => {
    it('returns AUTH_REQUIRED when user is unauthenticated', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue(null as any);

      const { data, error } = await loadAuctionHistoryRecord(mockRoomId);
      expect(data).toBeNull();
      expect(error).toContain('AUTH_REQUIRED');
    });

    it('returns AUCTION_NOT_FOUND when auction does not exist for room', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: mockUserId } as any);

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'rooms') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: mockRoomId, code: 'R1', name: 'Room 1', host_id: mockUserId },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'room_participants') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p1' }, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === 'auctions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(clientModule, 'createClient').mockReturnValue(mockSupabase as any);

      const { data, error } = await loadAuctionHistoryRecord(mockRoomId);
      expect(data).toBeNull();
      expect(error).toContain('AUCTION_NOT_FOUND');
    });
  });

  describe('loadUserCompletedAuctionsList', () => {
    it('returns AUTH_REQUIRED when user is unauthenticated', async () => {
      vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue(null as any);

      const { data, error } = await loadUserCompletedAuctionsList();
      expect(data).toBeNull();
      expect(error).toContain('AUTH_REQUIRED');
    });
  });
});
