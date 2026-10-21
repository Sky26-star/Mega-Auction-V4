import { describe, expect, it, vi } from 'vitest';
import { getAuctionTickClientConfig, requestAuctionTick } from '@/lib/auction/tick-client';

const secret = 'unit-test-auction-tick-secret'.padEnd(48, 'k');

describe('authenticated auction tick client', () => {
  it('requires a configured secret', () => {
    expect(() => getAuctionTickClientConfig({ AUCTION_TICK_URL: 'https://auction.example/api/auction/tick' }))
      .toThrow('AUCTION_TICK_SECRET');
  });

  it('requires a sufficiently long secret', () => {
    expect(() => getAuctionTickClientConfig({
      AUCTION_TICK_URL: 'https://auction.example/api/auction/tick',
      AUCTION_TICK_SECRET: 'short',
    })).toThrow('at least 32');
  });

  it('requires the worker endpoint URL', () => {
    expect(() => getAuctionTickClientConfig({ AUCTION_TICK_SECRET: secret }))
      .toThrow('AUCTION_TICK_URL');
  });

  it('rejects non-loopback HTTP so the secret is not sent in cleartext', () => {
    expect(() => getAuctionTickClientConfig({
      AUCTION_TICK_URL: 'http://auction.example/api/auction/tick',
      AUCTION_TICK_SECRET: secret,
    })).toThrow('HTTPS');
  });

  it('accepts HTTPS and loopback HTTP configuration', () => {
    expect(getAuctionTickClientConfig({
      AUCTION_TICK_URL: 'https://auction.example/api/auction/tick',
      AUCTION_TICK_SECRET: secret,
    })).toEqual({ url: 'https://auction.example/api/auction/tick', secret });

    expect(getAuctionTickClientConfig({
      AUCTION_TICK_URL: 'http://127.0.0.1:3000/api/auction/tick',
      AUCTION_TICK_SECRET: secret,
    }).url).toBe('http://127.0.0.1:3000/api/auction/tick');
  });

  it('sends the server credential only in the dedicated request header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });

    await requestAuctionTick({
      url: 'https://auction.example/api/auction/tick',
      secret,
    }, fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith('https://auction.example/api/auction/tick', expect.objectContaining({
      method: 'POST',
      headers: { 'x-auction-tick-secret': secret },
      cache: 'no-store',
      redirect: 'error',
    }));
  });

  it('does not include the secret in failed request errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0) });

    let failure: unknown;
    try {
      await requestAuctionTick({
        url: 'https://auction.example/api/auction/tick',
        secret,
      }, fetchMock as unknown as typeof fetch);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('HTTP 401');
    expect((failure as Error).message).not.toContain(secret);
  });

  it('bounds the request and maps an aborted fetch to a timeout without leaking credentials', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const request = requestAuctionTick({
        url: 'https://auction.example/api/auction/tick',
        secret,
      }, fetchMock as unknown as typeof fetch, { timeoutMs: 25 });
      const result = request.then(() => null, (error: unknown) => error);

      await vi.advanceTimersByTimeAsync(25);
      const failure = await result;
      expect(failure).toMatchObject({ name: 'AuctionTickTimeoutError' });
      expect((failure as Error).message).not.toContain(secret);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an in-flight request on caller shutdown and removes the abort listener', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      notifyStarted();
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    const request = requestAuctionTick({
      url: 'https://auction.example/api/auction/tick',
      secret,
    }, fetchMock as unknown as typeof fetch, { timeoutMs: 10_000, signal: controller.signal });

    await started;
    controller.abort();

    await expect(request).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not start a request when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();

    await expect(requestAuctionTick({
      url: 'https://auction.example/api/auction/tick',
      secret,
    }, fetchMock as unknown as typeof fetch, { signal: controller.signal })).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
