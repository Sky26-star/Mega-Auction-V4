import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server-session';
import { createClient } from '@/lib/supabase/server';
import { profileSchema } from '@/lib/validations/auth';

const PROFILE_FIELDS = 'id, username, display_name, avatar_url, created_at, updated_at';

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ profile: null }, { status: 401 });
    const supabase = await createClient();
    const { data: profile, error } = await supabase.from('profiles')
      .select(PROFILE_FIELDS).eq('id', userId).maybeSingle();
    if (error) return NextResponse.json({ profile: null, error: 'Profile could not be loaded.' }, { status: 503 });
    if (!profile) return NextResponse.json({
      profile: null, error: 'PROFILE_REQUIRED',
      message: 'Your account profile needs administrator review. Please contact the room host.',
    }, { status: 409 });
    return NextResponse.json({ profile });
  } catch {
    return NextResponse.json({ profile: null, error: 'Profile service unavailable.' }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const input = profileSchema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: 'Invalid profile details.' }, { status: 400 });
    const supabase = await createClient();
    const { data: profile, error } = await supabase.from('profiles')
      .update({ display_name: input.data.displayName, avatar_url: input.data.avatarUrl || null })
      .eq('id', userId).select(PROFILE_FIELDS).single();
    if (error || !profile) return NextResponse.json({ error: 'Profile could not be updated.' }, { status: 400 });
    return NextResponse.json({ profile });
  } catch {
    return NextResponse.json({ error: 'Invalid request or unavailable profile service.' }, { status: 400 });
  }
}
