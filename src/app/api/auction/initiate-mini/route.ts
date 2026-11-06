import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server-session';
import { createClient } from '@/lib/supabase/server';
import { getAuctionRpcFailure } from '@/lib/auction/rpc-response';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { auctionId } = body || {};
    if (!auctionId) {
      return NextResponse.json(
        { success: false, error: 'Missing auctionId' },
        { status: 400 }
      );
    }

    // Call authoritative v3_initiate_mini_auction RPC
    const { data, error } = await supabase.rpc('v3_initiate_mini_auction', {
      p_auction_id: auctionId,
    });

    const rpcFailure = getAuctionRpcFailure(data, error, 'RPC returned no successful result.');
    if (rpcFailure) {
      console.error('Mini-auction RPC failed:', {
        code: error?.code ?? 'RPC_REJECTED',
      });
      if (!error && data && typeof data === 'object' && !Array.isArray(data)) {
        const rpcErrorCode = typeof data.error === 'string' ? data.error : rpcFailure;
        if (rpcErrorCode === 'ERR_UNAUTHORIZED') {
          return NextResponse.json({ success: false, error: rpcErrorCode }, { status: 403 });
        }
        if (rpcErrorCode === 'ERR_AUCTION_NOT_COMPLETED') {
          return NextResponse.json({ success: false, error: rpcErrorCode }, { status: 400 });
        }
        if (rpcErrorCode === 'ERR_AUCTION_NOT_FOUND' || rpcErrorCode === 'ERR_ROOM_NOT_FOUND') {
          return NextResponse.json({ success: false, error: rpcErrorCode }, { status: 404 });
        }
      }
      return NextResponse.json(
        { success: false, error: 'Mini-auction request failed' },
        { status: error ? 500 : (!data || typeof data !== 'object' || Array.isArray(data) ? 502 : 400) }
      );
    }

    return NextResponse.json({ success: true, ...data }, { status: 200 });
  } catch (err: any) {
    console.error('Mini auction initiate route error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
