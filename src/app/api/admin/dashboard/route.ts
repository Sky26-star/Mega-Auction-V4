// src/app/api/admin/dashboard/route.ts
// Authoritative Platform Admin API Route

import { NextResponse } from 'next/server';
import { verifyAdminUser } from '@/lib/admin/auth';
import { loadAdminDashboardData } from '@/lib/admin/loader';

export async function GET() {
  // 1. Authoritative Server Admin Verification
  const authCheck = await verifyAdminUser();
  if (!authCheck.authorized || !authCheck.profile) {
    return NextResponse.json(
      { error: authCheck.error || 'FORBIDDEN: Platform Administrator access required.' },
      { status: 403 }
    );
  }

  // 2. Load Platform Admin Data
  const { data, error } = await loadAdminDashboardData();
  if (error || !data) {
    return NextResponse.json(
      { error: error || 'FAILED_TO_LOAD_ADMIN_DATA: Could not retrieve platform statistics.' },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}
