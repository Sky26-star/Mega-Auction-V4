import { describe, expect, it, vi } from 'vitest';
import { AuctionTickHttpError, AuctionTickTimeoutError, requestAuctionTick } from '@/lib/auction/tick-client';
import { isRecoverableTickError, retryDelayMs, runAuctionTickLoop } from '@/lib/auction/worker-runtime';

describe('auction worker runtime', () => {
  it('retries only known temporary HTTP and network failures', () => {
    expect(isRecoverableTickError(new AuctionTickTimeoutError(10_000))).toBe(true);
    expect(isRecoverableTickError(new AuctionTickHttpError(503))).toBe(false);
    expect(isRecoverableTickError(new AuctionTickHttpError(429))).toBe(true);
    expect(isRecoverableTickError(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRecoverableTickError(Object.assign(new Error('permission denied'), { code: 'EACCES' }))).toBe(false);
    expect(isRecoverableTickError(new TypeError('fetch failed'))).toBe(false);
  });

  it('uses bounded exponential backoff', () => {
    expect(retryDelayMs(1)).toBe(500);
    expect(retryDelayMs(2)).toBe(1_000);
    expect(retryDelayMs(20)).toBe(30_000);
  });

  it('exits on fatal errors instead of retrying indefinitely', async () => {
    const controller = new AbortController();
    const onFatalError = vi.fn();
    const wait = vi.fn(async () => undefined);
    const code = await runAuctionTickLoop({
      tick: async () => { throw new AuctionTickHttpError(401); },
      signal: controller.signal,
      wait,
      onFatalError,
    });
    expect(code).toBe(1);
    expect(onFatalError).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it('waits for one in-flight tick on SIGTERM and starts no subsequent tick', async () => {
    const controller = new AbortController();
    let releaseTick!: () => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const tick = vi.fn(() => new Promise<void>((resolve) => {
      releaseTick = resolve;
      notifyStarted();
    }));

    const loop = runAuctionTickLoop({ tick, signal: controller.signal, intervalMs: 1 });
    await started;
    controller.abort();
    expect(tick).toHaveBeenCalledOnce();
    releaseTick();
    await expect(loop).resolves.toBe(0);
    expect(tick).toHaveBeenCalledOnce();
  });

  it('treats cancellation of the in-flight HTTP request as normal shutdown', async () => {
    const controller = new AbortController();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      notifyStarted();
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const tick = vi.fn(() => requestAuctionTick({
      url: 'https://auction.example/api/auction/tick',
      secret: 'worker-test-secret'.padEnd(40, 'x'),
    }, fetchMock as unknown as typeof fetch, { signal: controller.signal }));
    const onTransientError = vi.fn();
    const onFatalError = vi.fn();

    const loop = runAuctionTickLoop({ tick, signal: controller.signal, onTransientError, onFatalError });
    await started;
    controller.abort();

    await expect(loop).resolves.toBe(0);
    expect(tick).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onTransientError).not.toHaveBeenCalled();
    expect(onFatalError).not.toHaveBeenCalled();
  });

  it('keeps unexpected request failures on the fatal error path', async () => {
    const controller = new AbortController();
    const failure = new TypeError('fetch failed');
    const fetchMock = vi.fn().mockRejectedValue(failure);
    const onTransientError = vi.fn();
    const onFatalError = vi.fn();

    const code = await runAuctionTickLoop({
      signal: controller.signal,
      tick: () => requestAuctionTick({
        url: 'https://auction.example/api/auction/tick',
        secret: 'worker-test-secret'.padEnd(40, 'x'),
      }, fetchMock as unknown as typeof fetch, { signal: controller.signal }),
      onTransientError,
      onFatalError,
    });

    expect(code).toBe(1);
    expect(onFatalError).toHaveBeenCalledWith(failure);
    expect(onTransientError).not.toHaveBeenCalled();
  });

  it('backs off after recoverable failures and remains serialized', async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    const loop = runAuctionTickLoop({
      signal: controller.signal,
      tick: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        calls += 1;
        await Promise.resolve();
        active -= 1;
        if (calls === 1) throw new AuctionTickTimeoutError(10_000);
        controller.abort();
      },
      wait: async (ms) => { delays.push(ms); },
    });

    await expect(loop).resolves.toBe(0);
    expect(calls).toBe(2);
    expect(delays).toEqual([500]);
    expect(maximumActive).toBe(1);
  });
});
