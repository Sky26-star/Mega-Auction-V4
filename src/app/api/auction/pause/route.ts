import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { auctionId } = await request.json();
    if (!auctionId) {
      return NextResponse.json({ success: false, error: 'Missing auctionId' }, { status: 400 });
    }

    // Call the authoritative pause_auction RPC.
    // The RPC itself validates that the caller is the host of the room.
    const { data, error } = await supabase.rpc('pause_auction', {
      p_auction_id: auctionId,
      p_reason: 'Admin Paused'
    });

    if (error) {
      console.error('Error in pause_auction RPC:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (data && data.success === false) {
      return NextResponse.json({ success: false, error: data.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...data });

  } catch (err: any) {
    console.error('Pause auction error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
