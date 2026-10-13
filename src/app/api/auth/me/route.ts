// src/app/api/auth/me/route.ts

import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ profile: null }, { status: 401 });
    }

    const adminClient = createAdminClient();

    // 1. Check if mapping already exists for this Clerk user
    const { data: mapping, error: mappingError } = await adminClient
      .from('clerk_user_mappings')
      .select('profile_id')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    if (mappingError && mappingError.code !== 'PGRST116') {
      console.error('Error fetching mapping:', mappingError);
    }

    let profileId = mapping?.profile_id;

    if (!profileId) {
      // 2. Provision identity if it doesn't exist
      const user = await currentUser();
      if (!user) {
        return NextResponse.json({ profile: null }, { status: 404 });
      }

      const primaryEmailObj = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
      const email = primaryEmailObj?.emailAddress;
      
      if (!email) {
        return NextResponse.json({ profile: null, error: 'No email found on Clerk identity' }, { status: 400 });
      }

      const username = user.username || email.split('@')[0];
      const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || username;
      const avatarUrl = user.imageUrl || '';

      // Create Supabase shadow user
      // We rely on Supabase Auth Admin to enforce email uniqueness. 
      // If it throws "already registered", we DO NOT blindly merge identities.
      const { data: shadowUser, error: authError } = await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { clerk_id: userId }
      });

      if (authError || !shadowUser?.user) {
        if (authError?.message?.includes('already registered') || authError?.code === 'email_exists') {
           // A legacy Supabase user exists with this email. 
           // We do NOT merge automatically per explicit security policy.
           return NextResponse.json({ 
             profile: null, 
             error: 'MIGRATION_REQUIRED',
             message: 'An existing account with this email was found. Automatic merging is disabled for security.'
           }, { status: 409 });
        }
        throw new Error(`Failed to provision shadow user: ${authError?.message}`);
      }
      
      profileId = shadowUser.user.id;

      // Ensure Profile exists (since we bypassed frontend triggers)
      const { error: profileError } = await adminClient
        .from('profiles')
        .insert({
          id: profileId,
          username,
          display_name: displayName,
          avatar_url: avatarUrl,
        });

      if (profileError && profileError.code !== '23505') { // Ignore unique violation if trigger fired
        await adminClient
          .from('profiles')
          .update({
            username,
            display_name: displayName,
            avatar_url: avatarUrl,
          })
          .eq('id', profileId);
      }

      // Create Mapping
      const { error: mapInsertError } = await adminClient
        .from('clerk_user_mappings')
        .insert({
          clerk_user_id: userId,
          profile_id: profileId,
        });

      if (mapInsertError) {
        // Idempotent recovery: If mapping already exists (race condition), fetch it
        if (mapInsertError.code === '23505') {
           const { data: existingMap } = await adminClient
             .from('clerk_user_mappings')
             .select('profile_id')
             .eq('clerk_user_id', userId)
             .maybeSingle();
             
           if (existingMap?.profile_id) {
             profileId = existingMap.profile_id;
           } else {
             throw new Error(`Failed to recover mapping after race condition`);
           }
        } else {
          throw new Error(`Failed to create user mapping: ${mapInsertError.message}`);
        }
      }
    }

    // 3. Fetch the actual profile data to return to the client
    const { data: profile, error } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single();

    if (error || !profile) {
      return NextResponse.json(
        { profile: null },
        { status: 404 }
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('GET /api/auth/me ERROR:', error);
    return NextResponse.json(
      {
        profile: null,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const adminClient = createAdminClient();

    // Find internal profile ID
    const { data: mapping } = await adminClient
      .from('clerk_user_mappings')
      .select('profile_id')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    if (!mapping?.profile_id) {
      return NextResponse.json({ error: 'User mapping not found' }, { status: 400 });
    }

    const data = await request.json();

    // Use admin client to ensure update works even if RLS checks auth.uid() which might not match
    const { data: updatedProfile, error } = await adminClient
      .from('profiles')
      .update({
        display_name: data.displayName.trim(),
        avatar_url: data.avatarUrl
          ? data.avatarUrl.trim()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mapping.profile_id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      profile: updatedProfile,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Server error',
      },
      { status: 500 }
    );
  }
}