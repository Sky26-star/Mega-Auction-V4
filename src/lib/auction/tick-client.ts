import {
  AUCTION_TICK_SECRET_HEADER,
  AUCTION_TICK_SECRET_MIN_LENGTH,
} from './tick-auth';
import { isTickResult, type TickResult } from './tick-result';

export interface AuctionTickClientConfig {
  url: string;
  secret: string;
  vercelBypassSecret?: string;
}

export class AuctionTickHttpError extends Error {
  constructor(public readonly status: number, result?: TickResult) {
    super(`Authenticated auction tick failed with HTTP ${status}.`);
    this.name = 'AuctionTickHttpError';
    // Keep structured outcomes available to recovery callers without including
    // response contents in ordinary error serialization/logging.
    Object.defineProperty(this, 'result', { value: result, enumerable: false });
  }
  declare readonly result?: TickResult;
}

async function readFailureResult(response: Response): Promise<TickResult | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) return undefined;
      text += decoder.decode(chunk.value, { stream: true });
    }
    const result: unknown = JSON.parse(text + decoder.decode());
    return isTickResult(result) ? result : undefined;
  } catch {
    return undefined;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class AuctionTickTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Authenticated auction tick exceeded its ${timeoutMs}ms request timeout.`);
    this.name = 'AuctionTickTimeoutError';
  }
}

type TickEnvironment = {
  AUCTION_TICK_URL?: string;
  AUCTION_TICK_SECRET?: string;
  AUCTION_TICK_VERCEL_BYPASS_SECRET?: string;
};

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function getAuctionTickClientConfig(
  env: TickEnvironment = {
    AUCTION_TICK_URL: process.env.AUCTION_TICK_URL,
    AUCTION_TICK_SECRET: process.env.AUCTION_TICK_SECRET,
    AUCTION_TICK_VERCEL_BYPASS_SECRET: process.env.AUCTION_TICK_VERCEL_BYPASS_SECRET,
  },
): AuctionTickClientConfig {
  const secret = env.AUCTION_TICK_SECRET;
  if (!secret || secret.length < AUCTION_TICK_SECRET_MIN_LENGTH || /\s/.test(secret)) {
    throw new Error('AUCTION_TICK_SECRET must be configured as at least 32 characters without whitespace.');
  }

  const rawUrl = env.AUCTION_TICK_URL;
  if (!rawUrl) {
    throw new Error('AUCTION_TICK_URL must be configured for the worker.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('AUCTION_TICK_URL must be a valid absolute URL.');
  }

  if (
    parsedUrl.pathname !== '/api/auction/tick' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error('AUCTION_TICK_URL must target /api/auction/tick without credentials or query parameters.');
  }

  if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLoopback(parsedUrl.hostname))) {
    throw new Error('AUCTION_TICK_URL must use HTTPS except for a loopback development URL.');
  }

  const bypass = env.AUCTION_TICK_VERCEL_BYPASS_SECRET;
  if (bypass !== undefined && (!bypass || /\s/.test(bypass) || bypass === secret
    || parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.vercel.app'))) {
    throw new Error('Vercel bypass requires a separate nonempty credential and an HTTPS vercel.app endpoint.');
  }
  return { url: parsedUrl.toString(), secret, ...(bypass ? { vercelBypassSecret: bypass } : {}) };
}

export async function requestAuctionTick(
  config: AuctionTickClientConfig = getAuctionTickClientConfig(),
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (options.signal?.aborted) return;

  const timeoutMs = options.timeoutMs ?? 25_000;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        [AUCTION_TICK_SECRET_HEADER]: config.secret,
        ...(config.vercelBypassSecret ? { 'x-vercel-protection-bypass': config.vercelBypassSecret } : {}),
      },
      cache: 'no-store',
      // Never forward either credential to a redirect destination.
      redirect: 'manual',
      signal: controller.signal,
    });

    // Consume the small JSON response so the worker does not leave fetch bodies open
    // while repeating ticks. The same timeout covers headers and body consumption.
    if (!response.ok) {
      const result = await readFailureResult(response);
      throw new AuctionTickHttpError(response.status, result);
    }
    let result: unknown;
    try { result = await response.json(); } catch { throw new Error('Invalid auction tick response.'); }
    if (!isTickResult(result)) throw new Error('Invalid auction tick response contract.');
    if (!result.success) throw new AuctionTickHttpError(503, result);
  } catch (error) {
    if (options.signal?.aborted) return;
    if (timedOut) throw new AuctionTickTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
