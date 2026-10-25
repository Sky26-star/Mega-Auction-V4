import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { ProfileForm } from '@/components/auth/profile-form';
import { Navbar } from '@/components/layout/navbar';
import { getCurrentMappedProfile } from '@/lib/auth/server-profile';
import { verifyAdminUser } from '@/lib/admin/auth';

export const metadata = {
  title: 'Profile Settings | Mega Auction V1',
  description: 'Manage your user profile and display options',
};

export default async function ProfilePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/login');
  }

  const profile = await getCurrentMappedProfile();

  if (!profile) {
    redirect('/login');
  }

  const { authorized: isAdmin } = await verifyAdminUser();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-12">
        <ProfileForm initialProfile={profile} isAdmin={isAdmin} />
      </main>
    </div>
  );
}
