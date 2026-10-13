// src/app/api/admin/cleanup-rooms/route.ts
// Platform Admin API Endpoint to trigger Abandoned Room Expiration & Cleanup

import { NextResponse } from 'next/server';
import { verifyAdminUser } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  try {
    // 1. Authoritative Admin Security Check
    const authCheck = await verifyAdminUser();
    if (!authCheck.authorized || !authCheck.profile) {
      return NextResponse.json(
        { error: authCheck.error || 'FORBIDDEN: Platform Administrator access required.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const inactivityHours = typeof body.inactivityHours === 'number' ? body.inactivityHours : 24;
    const retentionDays = typeof body.retentionDays === 'number' ? body.retentionDays : 7;

    const adminSupabase = createAdminClient();

    // 2. Execute mark_abandoned_rooms_expired RPC
    const { data: markRes, error: markErr } = await adminSupabase.rpc('mark_abandoned_rooms_expired', {
      p_inactivity_hours: inactivityHours,
    });

    if (markErr) {
      console.error('[CLEANUP API ERROR - MARK EXPIRED]', markErr);
      return NextResponse.json({ success: false, error: markErr.message }, { status: 500 });
    }

    // 3. Execute cleanup_expired_abandoned_rooms RPC (Only deletes expired rooms with NO auction history)
    const { data: cleanupRes, error: cleanupErr } = await adminSupabase.rpc('cleanup_expired_abandoned_rooms', {
      p_expired_retention_days: retentionDays,
    });

    if (cleanupErr) {
      console.error('[CLEANUP API ERROR - SAFE CLEANUP]', cleanupErr);
      return NextResponse.json({ success: false, error: cleanupErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      markedResult: markRes,
      cleanupResult: cleanupRes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'INTERNAL_SERVER_ERROR';
    console.error('[CLEANUP API EXCEPTION]', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
