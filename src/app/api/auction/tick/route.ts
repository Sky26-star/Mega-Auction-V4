
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getConfiguredAuctionTickSecret,
  hasValidAuctionTickSecret,
} from '@/lib/auction/tick-auth';
import { executeAuctionTick } from '@/lib/auction/auction-orchestrator';
import { tickResult } from '@/lib/auction/tick-result';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

// HTTP clients wait 25s; pending requests are reconciled after 30s.
export const maxDuration = 20;

export async function POST(request: Request) {
  const expectedSecret = getConfiguredAuctionTickSecret();

  if (!expectedSecret) {
    return NextResponse.json(
      {
        success: false,
        error: 'Auction tick authentication is not configured.',
      },
      { status: 503 }
    );
  }

  if (!hasValidAuctionTickSecret(request, expectedSecret)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized.',
      },
      { status: 401 }
    );
  }

  try {
    const supabase = createAdminClient();

    // Verify who currently owns scheduler execution.
    const owner = await supabase.rpc('auction_scheduler_owner');

    // Native database scheduler owns all timer work.
    // The legacy HTTP tick must not execute.
    if (owner.data === 'DATABASE') {
      return NextResponse.json(
        tickResult([
          {
            action: 'DATABASE_SCHEDULER_OWNS_TICKS',
            status: 'failed',
          },
        ]),
        { status: 409 }
      );
    }

    // Fail closed if ownership cannot be verified.
    if (owner.error || owner.data !== 'LEGACY') {
      return NextResponse.json(
        tickResult([
          {
            action: 'SCHEDULER_OWNERSHIP_UNAVAILABLE',
            status: 'failed',
          },
        ]),
        { status: 503 }
      );
    }

    // Execute legacy work only when explicitly permitted.
    const result = await executeAuctionTick(supabase);

    // Never expose raw RPC errors or nested business data
    // in the scheduler HTTP response.
    const safeResult = tickResult(
      result.actions.map(({ action, status }) => ({
        action,
        status,
      }))
    );

    return NextResponse.json(safeResult, {
      status: safeResult.success ? 200 : 503,
    });
  } catch {
    // Do not log raw exception objects, database messages,
    // connection details, credentials or request headers.
    console.error('[AUCTION TICK ERROR] Unexpected route failure');

    return NextResponse.json(
      tickResult([
        {
          action: 'TICK_FAILED',
          status: 'failed',
          error: 'Internal auction tick failure.',
        },
      ]),
      { status: 500 }
    );
  }
}
