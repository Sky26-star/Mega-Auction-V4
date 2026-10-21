import {
  AUCTION_TICK_SECRET_HEADER,
  AUCTION_TICK_SECRET_MIN_LENGTH,
} from './tick-auth';

export interface AuctionTickClientConfig {
  url: string;
  secret: string;
}

export class AuctionTickHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Authenticated auction tick failed with HTTP ${status}.`);
    this.name = 'AuctionTickHttpError';
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
};

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function getAuctionTickClientConfig(
  env: TickEnvironment = {
    AUCTION_TICK_URL: process.env.AUCTION_TICK_URL,
    AUCTION_TICK_SECRET: process.env.AUCTION_TICK_SECRET,
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

  return { url: parsedUrl.toString(), secret };
}

export async function requestAuctionTick(
  config: AuctionTickClientConfig = getAuctionTickClientConfig(),
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (options.signal?.aborted) return;

  const timeoutMs = options.timeoutMs ?? 10_000;
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
      headers: { [AUCTION_TICK_SECRET_HEADER]: config.secret },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });

    // Consume the small JSON response so the worker does not leave fetch bodies open
    // while repeating ticks. The same timeout covers headers and body consumption.
    await response.arrayBuffer();

    if (!response.ok) {
      throw new AuctionTickHttpError(response.status);
    }
  } catch (error) {
    if (options.signal?.aborted) return;
    if (timedOut) throw new AuctionTickTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
