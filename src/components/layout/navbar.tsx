'use client';

// src/components/layout/navbar.tsx
import React from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useUser, useClerk } from '@clerk/nextjs';
import { Gavel, LogOut, LayoutDashboard, LogIn, UserPlus, Users, BarChart3, ArrowLeftRight, Menu } from 'lucide-react';

export function Navbar({ auctionRoom = false }: { auctionRoom?: boolean }) {
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
          <div className={`flex items-center ${auctionRoom ? 'gap-2 xl:gap-8' : 'space-x-8'}`}>
            <Link href="/" aria-label="Mega Auction home" className="group flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#E4B93F] flex items-center justify-center shadow-[0_0_15px_rgba(228,185,63,0.3)] group-hover:shadow-[0_0_20px_rgba(228,185,63,0.5)] transition-all">
                <Gavel className="w-5 h-5 text-[#0B0F0D]" />
              </div>
              <span className={`${auctionRoom ? 'hidden xl:inline' : ''} text-lg font-black uppercase tracking-widest text-[#F3F4F1] drop-shadow-md transition-colors group-hover:text-[#E4B93F]`}>
                Mega <span className="text-[#C9A227]">Auction</span>
              </span>
            </Link>

            {roomId && isSignedIn && (
              <div className={`${auctionRoom ? 'hidden xl:flex' : 'hidden md:flex'} items-center space-x-1.5 rounded-lg border border-[#2A312D] bg-[#181E1A] px-3 py-1.5`}>
                <Users className="w-3.5 h-3.5 text-[#E4B93F]" />
                <span className="text-[10px] font-bold text-[#E4B93F] uppercase tracking-widest">
                  Room <span className="text-[#F3F4F1] ml-1">{roomId}</span>
                </span>
              </div>
            )}
          </div>

          <div className={`flex min-w-0 items-center ${auctionRoom ? 'gap-2 xl:gap-6' : 'space-x-6'}`}>
            <Link
              href="/docs"
              className={`${auctionRoom ? 'hidden xl:block' : 'hidden md:block'} text-xs font-bold uppercase tracking-wider text-[#9CA6A0] transition-colors hover:text-[#F3F4F1]`}
            >
              Documentation
            </Link>

            <div className="h-4 w-px bg-[#2A312D] hidden md:block"></div>

            {!isLoaded ? (
              <div className="h-8 w-24 bg-[#181E1A] animate-pulse rounded-lg"></div>
            ) : isSignedIn ? (
              <div className={`flex min-w-0 items-center ${auctionRoom ? 'gap-2 xl:gap-4' : 'space-x-4'}`}>
                {auctionRoom && (
                  <details className="relative xl:hidden">
                    <summary
                      aria-label="Open room navigation"
                      className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-[#2A312D] bg-[#181E1A] text-[#F3F4F1] hover:border-[#C9A227] hover:text-[#E4B93F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F0D] [&::-webkit-details-marker]:hidden"
                    >
                      <Menu className="h-5 w-5" aria-hidden="true" />
                    </summary>
                    <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-[#2A312D] bg-[#141917] p-2 shadow-2xl">
                      <Link href={`/rooms/${roomId}/squad`} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold text-[#F3F4F1] hover:bg-[#1E2522] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]">
                        <Users className="h-4 w-4 text-[#C9A227]" aria-hidden="true" /> Squad
                      </Link>
                      <Link href={`/rooms/${roomId}/stats`} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold text-[#F3F4F1] hover:bg-[#1E2522] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]">
                        <BarChart3 className="h-4 w-4 text-[#C9A227]" aria-hidden="true" /> Stats
                      </Link>
                      <Link href={`/rooms/${roomId}/trades`} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold text-[#F3F4F1] hover:bg-[#1E2522] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]">
                        <ArrowLeftRight className="h-4 w-4 text-[#C9A227]" aria-hidden="true" /> Trades
                      </Link>
                      <Link href="/dashboard" className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold text-[#F3F4F1] hover:bg-[#1E2522] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]">
                        <LayoutDashboard className="h-4 w-4 text-[#C9A227]" aria-hidden="true" /> Dashboard
                      </Link>
                      <Link href="/profile" className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold text-[#F3F4F1] hover:bg-[#1E2522] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#C9A227]/50 bg-[#181E1A] text-[10px] font-extrabold text-[#E4B93F] font-mono-numbers">
                          {displayName.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate">{displayName}</span>
                      </Link>
                      <button
                        onClick={handleSignOut}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-bold text-[#9CA6A0] hover:bg-[#B8322E]/10 hover:text-[#B8322E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]"
                      >
                        <LogOut className="h-4 w-4" aria-hidden="true" /> Sign Out
                      </button>
                    </div>
                  </details>
                )}

                <div className={auctionRoom ? 'hidden items-center space-x-4 xl:flex' : 'flex items-center space-x-4'}>
                {roomId && (
                  <>
                    <Link
                      href={`/rooms/${roomId}/squad`}
                      className={`flex items-center space-x-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#F3F4F1] transition-all hover:bg-[#181E1A] hover:text-[#E4B93F] ${auctionRoom ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]' : ''}`}
                    >
                      <Users className="w-4 h-4 text-[#C9A227]" />
                      <span className="hidden sm:inline">Squad</span>
                    </Link>

                    <Link
                      href={`/rooms/${roomId}/stats`}
                      className={`flex items-center space-x-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#F3F4F1] transition-all hover:bg-[#181E1A] hover:text-[#E4B93F] ${auctionRoom ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]' : ''}`}
                    >
                      <BarChart3 className="w-4 h-4 text-[#C9A227]" />
                      <span className="hidden sm:inline">Stats</span>
                    </Link>

                    <Link
                      href={`/rooms/${roomId}/trades`}
                      className={`flex items-center space-x-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#F3F4F1] transition-all hover:bg-[#181E1A] hover:text-[#E4B93F] ${auctionRoom ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]' : ''}`}
                    >
                      <ArrowLeftRight className="w-4 h-4 text-[#C9A227]" />
                      <span className="hidden sm:inline">Trades</span>
                    </Link>
                  </>
                )}

                <Link
                  href="/dashboard"
                  className={`flex items-center space-x-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#F3F4F1] transition-all hover:bg-[#181E1A] hover:text-[#E4B93F] ${auctionRoom ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]' : ''}`}
                >
                  <LayoutDashboard className="w-4 h-4 text-[#C9A227]" />
                  <span className="hidden sm:inline">Dashboard</span>
                </Link>

                <div className="h-4 w-px bg-[#2A312D]"></div>

                <Link
                  href="/profile"
                  className={`flex items-center space-x-2 rounded-lg border border-[#2A312D] px-3 py-2 text-xs font-bold text-[#F3F4F1] transition-all hover:bg-[#181E1A] hover:text-[#E4B93F] ${auctionRoom ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]' : ''}`}
                >
                  <div className="w-6 h-6 rounded-full bg-[#181E1A] border border-[#C9A227]/50 flex items-center justify-center text-[#E4B93F] text-[10px] font-extrabold font-mono-numbers">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <span>{displayName}</span>
                </Link>

                <button
                  id="navbar-signout-btn"
                  onClick={handleSignOut}
                  className={`flex items-center space-x-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#9CA6A0] transition-all hover:bg-[#B8322E]/10 hover:text-[#B8322E] ${auctionRoom ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F]' : ''}`}
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
                </div>
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
