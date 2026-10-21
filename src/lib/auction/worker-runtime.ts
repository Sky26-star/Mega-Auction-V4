import { AuctionTickHttpError, AuctionTickTimeoutError } from './tick-client';

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 504]);
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);

export function isRecoverableTickError(error: unknown): boolean {
  if (error instanceof AuctionTickTimeoutError) return true;
  if (error instanceof AuctionTickHttpError) return RETRYABLE_HTTP_STATUSES.has(error.status);

  let current: unknown = error;
  const visited = new Set<unknown>();
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && RETRYABLE_NETWORK_CODES.has(candidate.code)) return true;
    current = candidate.cause;
  }
  return false;
}

export function retryDelayMs(retryCount: number, baseMs = 500, maxMs = 30_000): number {
  const exponent = Math.max(0, Math.min(30, Math.floor(retryCount) - 1));
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

export function retryDelayWithJitter(
  retryCount: number,
  baseMs = 500,
  maxMs = 30_000,
  random: () => number = Math.random
): number {
  const delay = retryDelayMs(retryCount, baseMs, maxMs);
  const jitterFactor = 0.5 + 0.5 * random();
  return Math.floor(delay * jitterFactor);
}

export interface AuctionTickLoopOptions {
  tick: () => Promise<void>;
  signal: AbortSignal;
  intervalMs?: number;
  computeDelay?: (retryCount: number) => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  onTransientError?: (error: unknown, retryCount: number, delayMs: number) => void;
  onFatalError?: (error: unknown) => void;
}

function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Runs serialized ticks. A pending HTTP request must have its own finite timeout. */
export async function runAuctionTickLoop(options: AuctionTickLoopOptions): Promise<number> {
  const intervalMs = options.intervalMs ?? 500;
  const wait = options.wait ?? abortableWait;
  const now = options.now ?? Date.now;
  let retryCount = 0;

  while (!options.signal.aborted) {
    const startedAt = now();
    try {
      await options.tick();
      retryCount = 0;
    } catch (error) {
      if (!isRecoverableTickError(error)) {
        options.onFatalError?.(error);
        return 1;
      }
      retryCount += 1;
      const computeDelay = options.computeDelay ?? retryDelayMs;
      const delayMs = computeDelay(retryCount);
      options.onTransientError?.(error, retryCount, delayMs);
      await wait(delayMs, options.signal);
      continue;
    }

    if (options.signal.aborted) break;
    const remainingDelay = Math.max(0, intervalMs - (now() - startedAt));
    if (remainingDelay > 0) await wait(remainingDelay, options.signal);
  }

  return 0;
}
