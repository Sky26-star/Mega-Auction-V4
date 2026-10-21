import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

import { getAuctionTickClientConfig, requestAuctionTick } from '../src/lib/auction/tick-client';
import { retryDelayWithJitter, runAuctionTickLoop } from '../src/lib/auction/worker-runtime';

const TARGET_INTERVAL_MS = 500;
const controller = new AbortController();
let shutdownSignal: NodeJS.Signals | undefined;

function requestShutdown(signal: NodeJS.Signals): void {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  console.log(`[WORKER] Received ${signal}; cancelling active in-flight request before shutdown.`);
  controller.abort();
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

async function runWorker(): Promise<void> {
  console.log('[WORKER] Starting Mega Auction authoritative background worker...');
  console.log(`[WORKER] Runtime: Node ${process.version} (pid: ${process.pid}, platform: ${process.platform})`);
  console.log(`[WORKER] Environment: NODE_ENV=${process.env.NODE_ENV || 'development'}`);

  // In non-production, allow falling back to NEXT_PUBLIC_APP_URL if AUCTION_TICK_URL is not set
  if (!process.env.AUCTION_TICK_URL && process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_APP_URL) {
    const defaultUrl = `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/api/auction/tick`;
    process.env.AUCTION_TICK_URL = defaultUrl;
    console.log(`[WORKER] AUCTION_TICK_URL defaulted from NEXT_PUBLIC_APP_URL: ${defaultUrl}`);
  }

  let tickConfig;
  try {
    tickConfig = getAuctionTickClientConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid worker configuration.';
    console.error(`[WORKER] FATAL INITIALIZATION ERROR: ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log('[WORKER] Configuration verified:');
  console.log(`[WORKER]   - AUCTION_TICK_URL: ${tickConfig.url}`);
  console.log(`[WORKER]   - AUCTION_TICK_SECRET: configured (${tickConfig.secret.length} characters)`);
  console.log(`[WORKER] Authenticated tick client ready; serialized cadence ${TARGET_INTERVAL_MS}ms.`);

  const exitCode = await runAuctionTickLoop({
    tick: () => requestAuctionTick(tickConfig, undefined, { signal: controller.signal }),
    signal: controller.signal,
    intervalMs: TARGET_INTERVAL_MS,
    computeDelay: (count) => retryDelayWithJitter(count),
    onTransientError: (_error, retryCount, delayMs) => {
      console.warn(`[WORKER] Temporary tick failure; retry ${retryCount} in ${delayMs}ms.`);
    },
    onFatalError: (error) => {
      const message = error instanceof Error ? error.message : 'Unknown tick failure.';
      console.error(`[WORKER] FATAL TICK ERROR: ${message}`);
    },
  });

  process.exitCode = exitCode;
  if (exitCode === 0) console.log('[WORKER] Shutdown complete.');
}

void runWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown worker failure.';
  console.error(`[WORKER] UNEXPECTED FATAL ERROR: ${message}`);
  process.exitCode = 1;
});
