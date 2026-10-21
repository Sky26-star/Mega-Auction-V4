import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConfiguredAuctionTickSecret, hasValidAuctionTickSecret } from '@/lib/auction/tick-auth';
import { executeAuctionTick } from '@/lib/auction/auction-orchestrator';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const expectedSecret = getConfiguredAuctionTickSecret();
  if (!expectedSecret) {
    return NextResponse.json({ success: false, error: 'Auction tick authentication is not configured.' }, { status: 503 });
  }

  if (!hasValidAuctionTickSecret(request, expectedSecret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const result = await executeAuctionTick(supabase);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[AUCTION TICK ERROR]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}
