import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server-session';
import { createAdminClient } from '@/lib/supabase/admin';
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

    // 1. Validate Admin (Host)
    // We check the room ownership matching the current user
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('room_id, status, paused_reason')
      .eq('id', auctionId)
      .single();

    if (auctionError || !auction) {
      return NextResponse.json({ success: false, error: 'Auction not found' }, { status: 404 });
    }

    if (auction.status !== 'PAUSED') {
      return NextResponse.json({ success: false, error: 'Auction is not paused' }, { status: 400 });
    }

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('host_id')
      .eq('id', auction.room_id)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ success: false, error: 'Room not found' }, { status: 404 });
    }

    // 1. Validate Admin (Host)
    // Supabase Auth user ID is the profile ID; never authorize by email.
    const adminClient = createAdminClient();

    const isAuthorizedHost = room.host_id === userId;

    if (!isAuthorizedHost) {
      return NextResponse.json({ success: false, error: 'Only the room host can resume the auction' }, { status: 403 });
    }

    // 2. Schedule Resume using authoritative countdown
    // We update paused_reason to include resume_expires_at
    let parsedReason: any = {};
    if (auction.paused_reason) {
      try {
        parsedReason = JSON.parse(auction.paused_reason);
      } catch (e) {
        // ignore
      }
    }

    // Include exactly 3.5 seconds countdown (3s + network buffer)
    parsedReason.resume_expires_at = Date.now() + 3500;

    const { error: updateError } = await adminClient
      .from('auctions')
      .update({ paused_reason: JSON.stringify(parsedReason) })
      .eq('id', auctionId);

    if (updateError) {
      console.error('Failed to update countdown state:', updateError);
      return NextResponse.json({ success: false, error: 'Failed to update countdown' }, { status: 500 });
    }

    // The durable scheduler owns the transition. A setTimeout after returning
    // an HTTP response is not reliable in a serverless runtime.

    return NextResponse.json({ success: true, message: 'Countdown started' });

  } catch (err: any) {
    console.error('Resume countdown error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
