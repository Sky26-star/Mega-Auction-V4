import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@/lib/supabase/server';

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

    if (error) {
      console.error('Error in v3_initiate_mini_auction RPC:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    if (data && data.success === false) {
      if (data.error === 'ERR_UNAUTHORIZED') {
        return NextResponse.json(
          { success: false, error: 'ERR_UNAUTHORIZED' },
          { status: 403 }
        );
      }
      if (data.error === 'ERR_AUCTION_NOT_COMPLETED') {
        return NextResponse.json(
          { success: false, error: 'ERR_AUCTION_NOT_COMPLETED' },
          { status: 400 }
        );
      }
      if (data.error === 'ERR_AUCTION_NOT_FOUND' || data.error === 'ERR_ROOM_NOT_FOUND') {
        return NextResponse.json(
          { success: false, error: data.error },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to initiate mini auction' },
        { status: 400 }
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
