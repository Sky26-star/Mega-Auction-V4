// src/test/unit/summary-loader.test.ts
// Unit Tests for Authoritative Summary Loader and Error Handling (Test K & Auth)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadAuctionSummaryData } from '@/lib/summary/loader';
import * as authModule from '@/lib/auth';
import * as clientModule from '@/lib/supabase/client';

describe('Authoritative Summary Loader: Security & Error Handling (Test K)', () => {
  const mockUserId = 'usr-test-123';
  const mockRoomId = 'room-abc-789';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('TEST K1: Returns AUTH_REQUIRED when user is not logged in', async () => {
    vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue(null as any);

    const { data, error } = await loadAuctionSummaryData(mockRoomId);
    expect(data).toBeNull();
    expect(error).toContain('AUTH_REQUIRED');
  });

  it('TEST K2: Returns ROOM_NOT_FOUND when room does not exist in DB', async () => {
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

    const { data, error } = await loadAuctionSummaryData(mockRoomId);
    expect(data).toBeNull();
    expect(error).toContain('ROOM_NOT_FOUND');
  });

  it('TEST K3: Returns UNAUTHORIZED when user is not host and not participant', async () => {
    vi.spyOn(authModule, 'getCurrentProfile').mockResolvedValue({ id: mockUserId } as any);

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: mockRoomId, code: 'R1', name: 'Room 1', host_id: 'different-host-id' },
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

    const { data, error } = await loadAuctionSummaryData(mockRoomId);
    expect(data).toBeNull();
    expect(error).toContain('UNAUTHORIZED');
  });

  it('TEST K4: Database error on lots fetch is returned as error, NEVER converted to fake empty results', async () => {
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
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'auc-1', room_id: mockRoomId, status: 'COMPLETED', total_lots: 5 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'teams') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'squad_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'auction_lots') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Connection to PostgreSQL failed: 503 Service Unavailable' },
                }),
              }),
            }),
          };
        }
        if (table === 'player_releases') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'mini_auction_sessions') {
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

    const { data, error } = await loadAuctionSummaryData(mockRoomId);
    expect(data).toBeNull();
    expect(error).toContain('LOTS_FETCH_ERROR');
    expect(error).toContain('Connection to PostgreSQL failed');
  });
});
