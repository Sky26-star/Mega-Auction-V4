import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server-session';
import { ProfileForm } from '@/components/auth/profile-form';
import { Navbar } from '@/components/layout/navbar';
import { getCurrentMappedProfile } from '@/lib/auth/server-profile';
import { verifyAdminUser } from '@/lib/admin/auth';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'Profile Settings | Mega Auction Arena',
  description: 'Manage your user profile and display options',
};

export default async function ProfilePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/sign-in');
  }

  const profile = await getCurrentMappedProfile();

  if (!profile) {
    redirect('/auth/complete');
  }

  const { authorized: isAdmin } = await verifyAdminUser();

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col">
      <Navbar />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        <Link href="/dashboard" className="mb-6 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[#9CA6A0] transition-colors hover:text-[#E4B93F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <header className="mb-7">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#C9A227]">Your auction identity</p>
          <h1 className="text-3xl font-bold uppercase sm:text-4xl">Profile <span className="text-[#E4B93F]">settings</span></h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#9CA6A0]">Make your name stand out across auction rooms, squads and trades.</p>
        </header>
        <ProfileForm initialProfile={profile} isAdmin={isAdmin} />
      </main>
    </div>
  );
}
