import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@/lib/supabase/server';
import { ProfileForm } from '@/components/auth/profile-form';
import { Navbar } from '@/components/layout/navbar';
import type { Profile } from '@/lib/types/auth';

export const metadata = {
  title: 'Profile Settings | Mega Auction V1',
  description: 'Manage your user profile and display options',
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const { userId } = await auth();
  if (!userId) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (!profile) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-12">
        <ProfileForm initialProfile={profile as Profile} />
      </main>
    </div>
  );
}
