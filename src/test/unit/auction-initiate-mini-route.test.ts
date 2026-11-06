
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    createClient: vi.fn(),
    rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server-session', () => ({
    auth: mocks.auth,
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: mocks.createClient,
}));

import { POST } from '@/app/api/auction/initiate-mini/route';

const makeRequest = () =>
    new Request('http://localhost/api/auction/initiate-mini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auctionId: 'test-auction' }),
    });

describe('initiate-mini API error safety', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.auth.mockResolvedValue({ userId: 'host-1' });
        mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => vi.restoreAllMocks());

    it('does not expose raw database transport errors', async () => {
        mocks.rpc.mockResolvedValue({
            data: null,
            error: {
                code: 'XX000',
                message: 'private database connection details',
            },
        });

        const response = await POST(makeRequest());
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            success: false,
            error: 'Mini-auction request failed',
        });
    });

    it('hides unknown business error messages', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                success: false,
                error: 'internal table details',
            },
            error: null,
        });

        const response = await POST(makeRequest());
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            success: false,
            error: 'Mini-auction request failed',
        });
    });

    it.each([
        ['ERR_UNAUTHORIZED', 403],
        ['ERR_AUCTION_NOT_COMPLETED', 400],
        ['ERR_AUCTION_NOT_FOUND', 404],
        ['ERR_ROOM_NOT_FOUND', 404],
    ])('preserves known error %s', async (code, status) => {
        mocks.rpc.mockResolvedValue({
            data: { success: false, error: code },
            error: null,
        });

        const response = await POST(makeRequest());
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({
            success: false,
            error: code,
        });
    });

    it('preserves successful responses', async () => {
        mocks.rpc.mockResolvedValue({
            data: { success: true, status: 'MINI_AUCTION' },
            error: null,
        });

        const response = await POST(makeRequest());
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            success: true,
            status: 'MINI_AUCTION',
        });
    });
});
