'use client';

// src/components/layout/navbar.tsx
import React from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useUser, useClerk } from '@clerk/nextjs';
import { Gavel, LogOut, LayoutDashboard, LogIn, UserPlus, Users, BarChart3, ArrowLeftRight } from 'lucide-react';

export function Navbar() {
  const router = useRouter();
  const params = useParams();
  const roomId = params?.id as string | undefined;
  
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const displayName = user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'User';

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#2A312D] bg-[#0B0F0D]/90 backdrop-blur-xl supports-[backdrop-filter]:bg-[#0B0F0D]/60 shadow-lg shadow-black/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-[#E4B93F] flex items-center justify-center shadow-[0_0_15px_rgba(228,185,63,0.3)] group-hover:shadow-[0_0_20px_rgba(228,185,63,0.5)] transition-all">
                <Gavel className="w-5 h-5 text-[#0B0F0D]" />
              </div>
              <span className="text-[#F3F4F1] text-lg font-black tracking-widest uppercase drop-shadow-md group-hover:text-[#E4B93F] transition-colors">
                Mega <span className="text-[#C9A227]">Auction</span>
              </span>
            </Link>

            {roomId && isSignedIn && (
              <div className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-[#181E1A] rounded-lg border border-[#2A312D]">
                <Users className="w-3.5 h-3.5 text-[#E4B93F]" />
                <span className="text-[10px] font-bold text-[#E4B93F] uppercase tracking-widest">
                  Room <span className="text-[#F3F4F1] ml-1">{roomId}</span>
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-6">
            <Link
              href="/docs"
              className="hidden md:block text-xs font-bold text-[#9CA6A0] hover:text-[#F3F4F1] uppercase tracking-wider transition-colors"
            >
              Documentation
            </Link>

            <div className="h-4 w-px bg-[#2A312D] hidden md:block"></div>

            {!isLoaded ? (
              <div className="h-8 w-24 bg-[#181E1A] animate-pulse rounded-lg"></div>
            ) : isSignedIn ? (
              <div className="flex items-center space-x-4">
                {roomId && (
                  <>
                    <Link
                      href={`/rooms/${roomId}/squad`}
                      className="flex items-center space-x-1.5 text-xs font-bold text-[#F3F4F1] hover:text-[#E4B93F] px-3 py-2 rounded-lg hover:bg-[#181E1A] transition-all uppercase tracking-wider"
                    >
                      <Users className="w-4 h-4 text-[#C9A227]" />
                      <span className="hidden sm:inline">Squad</span>
                    </Link>

                    <Link
                      href={`/rooms/${roomId}/stats`}
                      className="flex items-center space-x-1.5 text-xs font-bold text-[#F3F4F1] hover:text-[#E4B93F] px-3 py-2 rounded-lg hover:bg-[#181E1A] transition-all uppercase tracking-wider"
                    >
                      <BarChart3 className="w-4 h-4 text-[#C9A227]" />
                      <span className="hidden sm:inline">Stats</span>
                    </Link>

                    <Link
                      href={`/rooms/${roomId}/trades`}
                      className="flex items-center space-x-1.5 text-xs font-bold text-[#F3F4F1] hover:text-[#E4B93F] px-3 py-2 rounded-lg hover:bg-[#181E1A] transition-all uppercase tracking-wider"
                    >
                      <ArrowLeftRight className="w-4 h-4 text-[#C9A227]" />
                      <span className="hidden sm:inline">Trades</span>
                    </Link>
                  </>
                )}

                <Link
                  href="/dashboard"
                  className="flex items-center space-x-1.5 text-xs font-bold text-[#F3F4F1] hover:text-[#E4B93F] px-3 py-2 rounded-lg hover:bg-[#181E1A] transition-all uppercase tracking-wider"
                >
                  <LayoutDashboard className="w-4 h-4 text-[#C9A227]" />
                  <span className="hidden sm:inline">Dashboard</span>
                </Link>

                <div className="h-4 w-px bg-[#2A312D]"></div>

                <Link
                  href="/profile"
                  className="flex items-center space-x-2 text-xs font-bold text-[#F3F4F1] hover:text-[#E4B93F] px-3 py-2 rounded-lg hover:bg-[#181E1A] transition-all border border-[#2A312D]"
                >
                  <div className="w-6 h-6 rounded-full bg-[#181E1A] border border-[#C9A227]/50 flex items-center justify-center text-[#E4B93F] text-[10px] font-extrabold font-mono-numbers">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <span>{displayName}</span>
                </Link>

                <button
                  id="navbar-signout-btn"
                  onClick={handleSignOut}
                  className="flex items-center space-x-1.5 text-xs font-bold text-[#9CA6A0] hover:text-[#B8322E] px-3 py-2 rounded-lg hover:bg-[#B8322E]/10 transition-all uppercase tracking-wider"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <Link
                  href="/login"
                  className="flex items-center space-x-1.5 text-xs font-bold text-[#F3F4F1] hover:text-[#E4B93F] px-3.5 py-2 rounded-lg hover:bg-[#181E1A] transition-all uppercase tracking-wider"
                >
                  <LogIn className="w-4 h-4 text-[#C9A227]" />
                  <span>Sign In</span>
                </Link>

                <Link
                  href="/login"
                  className="flex items-center space-x-1.5 text-xs font-bold text-[#F3F4F1] bg-[#B8322E] hover:bg-[#9B2825] px-4 py-2 rounded-lg shadow-md shadow-[#B8322E]/20 transition-all uppercase tracking-wider"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Sign Up</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
