import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient } from '@/lib/supabase/server';
import { Navbar } from '@/components/layout/navbar';

import {
  Gavel,
  PlusCircle,
  LogIn,
  User,
  Database,
  ShieldCheck,
  Trophy,
  History,
  ArrowRight,
  Sparkles,
  Radio,
} from 'lucide-react';

export const metadata = {
  title: 'Dashboard | Mega Auction Arena',
  description: 'Real-time cricket auction simulator control center',
};

export default async function DashboardPage() {
  // ------------------------------------------------------------
  // Clerk is the authoritative authentication provider.
  // ------------------------------------------------------------
  const { userId } = await auth();

  // No authenticated Clerk session → login.
  if (!userId) {
    redirect('/login');
  }

  // ------------------------------------------------------------
  // Current Clerk user
  // ------------------------------------------------------------
  const clerkUser = await currentUser();

  // ------------------------------------------------------------
  // Supabase is used for application data only.
  // ------------------------------------------------------------
  const supabase = await createClient();

  // ------------------------------------------------------------
  // Fetch User Profile
  // ------------------------------------------------------------
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  // ------------------------------------------------------------
  // Fetch User's Recent Rooms
  // Hosted OR joined as participant.
  // ------------------------------------------------------------
  const { data: participantData } = await supabase
    .from('room_participants')
    .select('room_id')
    .eq('user_id', userId);

  const roomIds = (participantData || []).map(
    (p: { room_id: string }) => p.room_id
  );

  // ------------------------------------------------------------
  // Build recent rooms query
  // ------------------------------------------------------------
  let roomsQuery = supabase
    .from('rooms')
    .select(`
      *,
      host_profile:profiles!rooms_host_id_fkey(
        id,
        username,
        display_name,
        avatar_url
      ),
      auctions(
        id,
        status,
        player_set_id,
        player_sets(name)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(5);

  if (roomIds.length > 0) {
    roomsQuery = roomsQuery.or(
      `host_id.eq.${userId},id.in.(${roomIds.join(',')})`
    );
  } else {
    roomsQuery = roomsQuery.eq('host_id', userId);
  }

  const { data: roomRows } = await roomsQuery;

  const recentRooms = roomRows || [];

  // ------------------------------------------------------------
  // Activity metrics
  // ------------------------------------------------------------
  const activeRoomsCount = recentRooms.filter(
    (room) =>
      room.status === 'LOBBY' ||
      room.status === 'IN_PROGRESS' ||
      room.status === 'LIVE'
  ).length;

  const liveAuctionsCount = recentRooms.filter(
    (room) =>
      room.status === 'IN_PROGRESS' ||
      room.status === 'LIVE'
  ).length;

  const totalRoomsCount = recentRooms.length;

  // ------------------------------------------------------------
  // Display identity
  // ------------------------------------------------------------
  const displayName =
    profile?.display_name ||
    profile?.username ||
    clerkUser?.firstName ||
    clerkUser?.username ||
    'Franchise Owner';

  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ||
    'N/A';

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col relative overflow-x-hidden selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">

      {/* Top Application Navbar */}
      <Navbar />

      {/* Stadium Atmosphere & Floodlight Backdrop */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-25">
        <div className="absolute -top-40 -left-40 w-[700px] h-[700px] bg-[#C9A227]/10 rounded-full blur-[180px]" />

        <div className="absolute top-1/3 -right-40 w-[600px] h-[600px] bg-[#B8322E]/10 rounded-full blur-[180px]" />

        <div className="absolute inset-0 bg-[radial-gradient(#2A312D_1px,transparent_1px)] [background-size:32px_32px] opacity-20" />
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 relative z-10 my-auto">

        {/* ======================================================
            1. WELCOME HEADER
        ====================================================== */}
        <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-2xl shadow-black/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 relative overflow-hidden group">

          <div className="absolute top-0 left-0 w-1.5 h-full bg-[#C9A227]" />

          <div className="pl-2">
            <div className="flex items-center space-x-2.5 mb-1.5">

              <span className="text-2xl sm:text-3xl font-black font-display uppercase tracking-tight text-[#F3F4F1]">
                WELCOME BACK,{' '}
                <span className="text-[#C9A227]">
                  {displayName.toUpperCase()}
                </span>{' '}
                👋
              </span>

              {profile?.is_admin && (
                <Link
                  href="/admin"
                  className="px-2.5 py-0.5 rounded-full bg-[#C9A227]/15 text-[#E4B93F] border border-[#C9A227]/40 text-[10px] font-extrabold uppercase font-mono-numbers flex items-center gap-1 hover:bg-[#C9A227]/30 transition-all shadow-md"
                  title="Open Platform Admin Console"
                >
                  <ShieldCheck className="w-3 h-3 text-[#C9A227]" />
                  ADMIN CONSOLE
                </Link>
              )}

            </div>

            <p className="text-xs sm:text-sm text-[#9CA6A0] leading-relaxed">
              &quot;Ready to build your next dream squad?&quot; &bull;
              Manage auction rooms, custom player pools, and live bidding
              sessions.
            </p>
          </div>

          <Link
            href="/profile"
            className="px-4 py-2.5 rounded-xl bg-[#181E1A] hover:bg-[#222A25] text-[#F3F4F1] hover:text-[#E4B93F] border border-[#2A312D] hover:border-[#C9A227]/50 text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all shadow-sm flex-shrink-0"
          >
            <User className="w-4 h-4 text-[#C9A227]" />
            <span>EDIT PROFILE</span>
          </Link>
        </div>

        {/* ======================================================
            2. PRIMARY ACTION AREA
        ====================================================== */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* CREATE AUCTION ROOM */}
          <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#C9A227]/60 transition-all duration-300 shadow-2xl shadow-black/80 flex flex-col justify-between group">

            <div>
              <div className="flex items-center justify-between mb-4">

                <div className="w-12 h-12 rounded-xl bg-[#0B0F0D] border border-[#2A312D] group-hover:border-[#C9A227]/50 flex items-center justify-center text-[#E4B93F] group-hover:scale-105 transition-all">
                  <PlusCircle className="w-6 h-6 text-[#C9A227]" />
                </div>

                <span className="text-[10px] font-mono-numbers font-extrabold text-[#C9A227] uppercase bg-[#0B0F0D] px-2.5 py-1 rounded border border-[#2A312D]">
                  HOST CONTROL
                </span>
              </div>

              <h3 className="text-xl sm:text-2xl font-black text-[#F3F4F1] font-display uppercase tracking-wide mb-2">
                CREATE AUCTION ROOM
              </h3>

              <p className="text-xs sm:text-sm text-[#9CA6A0] mb-6 leading-relaxed">
                Build your room, configure starting purse, bid timer, bot
                opponents, and invite manager franchises.
              </p>
            </div>

            <Link
              href="/rooms/create"
              className="w-full py-4 px-6 rounded-xl bg-[#B8322E] hover:bg-[#9B2825] active:bg-[#8F2724] text-[#F3F4F1] font-bold text-xs uppercase tracking-widest shadow-xl shadow-[#B8322E]/20 border border-[#B8322E]/60 flex items-center justify-center space-x-2 transition-all group-hover:translate-y-[-2px]"
            >
              <span>CREATE ROOM</span>
              <ArrowRight className="w-4 h-4 text-[#F3F4F1] group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {/* JOIN AUCTION ROOM */}
          <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#C9A227]/60 transition-all duration-300 shadow-2xl shadow-black/80 flex flex-col justify-between group">

            <div>
              <div className="flex items-center justify-between mb-4">

                <div className="w-12 h-12 rounded-xl bg-[#0B0F0D] border border-[#2A312D] group-hover:border-[#C9A227]/50 flex items-center justify-center text-[#E4B93F] group-hover:scale-105 transition-all">
                  <LogIn className="w-6 h-6 text-[#E4B93F]" />
                </div>

                <span className="text-[10px] font-mono-numbers font-extrabold text-[#E4B93F] uppercase bg-[#0B0F0D] px-2.5 py-1 rounded border border-[#2A312D]">
                  MANAGER JOIN
                </span>
              </div>

              <h3 className="text-xl sm:text-2xl font-black text-[#F3F4F1] font-display uppercase tracking-wide mb-2">
                JOIN AUCTION ROOM
              </h3>

              <p className="text-xs sm:text-sm text-[#9CA6A0] mb-6 leading-relaxed">
                Enter a 6-character room code to jump straight into an active
                auction lobby as a competing manager.
              </p>
            </div>

            <Link
              href="/rooms/join"
              className="w-full py-4 px-6 rounded-xl bg-[#181E1A] hover:bg-[#222A25] text-[#F3F4F1] hover:text-[#E4B93F] font-bold text-xs uppercase tracking-widest border border-[#2A312D] hover:border-[#C9A227]/50 shadow-lg flex items-center justify-center space-x-2 transition-all group-hover:translate-y-[-2px]"
            >
              <span>JOIN ROOM WITH CODE</span>
              <ArrowRight className="w-4 h-4 text-[#C9A227] group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

        </div>

        {/* ======================================================
            3. LIVE ACTIVITY METRICS
        ====================================================== */}
        <div className="p-4 rounded-xl bg-[#141917] border-2 border-[#2A312D] flex flex-wrap items-center justify-around gap-4 sm:gap-8 text-xs shadow-xl">

          <div className="flex items-center space-x-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />

            <span className="text-[#9CA6A0] font-bold uppercase tracking-wider">
              ONLINE:
            </span>

            <span className="font-black font-mono-numbers text-[#F3F4F1] text-sm">
              1 MANAGER (ACTIVE)
            </span>
          </div>

          <div className="h-4 w-[1px] bg-[#2A312D] hidden sm:block" />

          <div className="flex items-center space-x-2.5">
            <Radio className="w-3.5 h-3.5 text-[#C9A227]" />

            <span className="text-[#9CA6A0] font-bold uppercase tracking-wider">
              ACTIVE ROOMS:
            </span>

            <span className="font-black font-mono-numbers text-[#E4B93F] text-sm">
              {activeRoomsCount} ROOMS
            </span>
          </div>

          <div className="h-4 w-[1px] bg-[#2A312D] hidden sm:block" />

          <div className="flex items-center space-x-2.5">
            <Gavel className="w-3.5 h-3.5 text-[#B8322E]" />

            <span className="text-[#9CA6A0] font-bold uppercase tracking-wider">
              LIVE AUCTIONS:
            </span>

            <span className="font-black font-mono-numbers text-[#B8322E] text-sm">
              {liveAuctionsCount} LIVE
            </span>
          </div>
        </div>

        {/* ======================================================
            4. RECENT AUCTION ROOMS
        ====================================================== */}
        <div className="p-6 sm:p-7 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-2xl shadow-black/80 space-y-5">

          <div className="flex items-center justify-between pb-3 border-b border-[#2A312D]">

            <div className="flex items-center space-x-2.5">

              <div className="w-7 h-7 rounded-lg bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#C9A227]">
                <Trophy className="w-4 h-4" />
              </div>

              <h2 className="text-base sm:text-lg font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                RECENT AUCTION ROOMS
              </h2>
            </div>

            <Link
              href="/rooms"
              className="text-xs font-bold text-[#E4B93F] hover:text-white uppercase tracking-wider flex items-center space-x-1 transition-colors"
            >
              <span>VIEW ALL</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentRooms.length === 0 ? (

            <div className="p-8 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-center space-y-3">

              <Gavel className="w-10 h-10 mx-auto text-[#9CA6A0] opacity-50" />

              <h4 className="text-sm font-bold text-[#F3F4F1] uppercase tracking-wider">
                NO RECENT AUCTION ROOMS FOUND
              </h4>

              <p className="text-xs text-[#9CA6A0] max-w-md mx-auto">
                You haven&apos;t created or joined any auction rooms yet.
                Create your first room to begin.
              </p>

              <Link
                href="/rooms/create"
                className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-[#B8322E] hover:bg-[#9B2825] text-white text-xs font-bold uppercase tracking-wider transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>CREATE FIRST ROOM</span>
              </Link>
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-left border-collapse">

                <thead>
                  <tr className="border-b border-[#2A312D] text-[10px] font-bold text-[#9CA6A0] uppercase tracking-widest">
                    <th className="py-3 px-3">ROOM NAME</th>
                    <th className="py-3 px-3">CODE</th>
                    <th className="py-3 px-3">HOST</th>
                    <th className="py-3 px-3">STATUS</th>
                    <th className="py-3 px-3">CREATED</th>
                    <th className="py-3 px-3 text-right">ACTION</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#2A312D]/60 text-xs">

                  {recentRooms.map((room) => {

                    const isLive =
                      room.status === 'IN_PROGRESS' ||
                      room.status === 'LIVE';

                    const isLobby =
                      room.status === 'LOBBY';

                    return (
                      <tr
                        key={room.id}
                        className="hover:bg-[#0B0F0D]/60 transition-colors group"
                      >

                        {/* Room Name */}
                        <td className="py-3.5 px-3 font-bold text-[#F3F4F1]">
                          <span className="truncate max-w-[200px] block">
                            {room.name}
                          </span>
                        </td>

                        {/* Room Code */}
                        <td className="py-3.5 px-3">
                          <span className="font-mono-numbers font-black text-[#E4B93F] bg-[#0B0F0D] px-2 py-0.5 rounded border border-[#2A312D] text-xs">
                            {room.code}
                          </span>
                        </td>

                        {/* Host */}
                        <td className="py-3.5 px-3 text-[#9CA6A0] font-semibold">
                          {room.host_profile?.display_name ||
                            room.host_profile?.username ||
                            'Host'}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-3">

                          {isLive ? (

                            <span className="px-2.5 py-0.5 rounded-full bg-[#B8322E]/20 text-[#B8322E] border border-[#B8322E]/50 text-[10px] font-black uppercase font-mono-numbers inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#B8322E] animate-pulse" />
                              LIVE
                            </span>

                          ) : isLobby ? (

                            <span className="px-2.5 py-0.5 rounded-full bg-[#C9A227]/20 text-[#E4B93F] border border-[#C9A227]/40 text-[10px] font-black uppercase font-mono-numbers inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#C9A227]" />
                              WAITING
                            </span>

                          ) : (

                            <span className="px-2.5 py-0.5 rounded-full bg-[#181E1A] text-[#9CA6A0] border border-[#2A312D] text-[10px] font-bold uppercase font-mono-numbers">
                              {room.status || 'COMPLETED'}
                            </span>

                          )}

                        </td>

                        {/* Created */}
                        <td className="py-3.5 px-3 text-[#9CA6A0] font-mono-numbers text-[11px]">
                          {room.created_at
                            ? new Date(room.created_at).toLocaleDateString()
                            : 'N/A'}
                        </td>

                        {/* Action */}
                        <td className="py-3.5 px-3 text-right">

                          {room.status === 'COMPLETED' ? (

                            <Link
                              href={`/rooms/${room.id}/summary`}
                              className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-400 hover:text-white px-2.5 py-1 rounded bg-[#0B0F0D] border border-emerald-500/40 hover:border-emerald-400 transition-all"
                            >
                              <span>SUMMARY</span>
                              <ArrowRight className="w-3 h-3" />
                            </Link>

                          ) : (

                            <Link
                              href={`/rooms/${room.id}`}
                              className="inline-flex items-center space-x-1 text-xs font-bold text-[#E4B93F] hover:text-white px-2.5 py-1 rounded bg-[#0B0F0D] border border-[#2A312D] hover:border-[#C9A227]/40 transition-all"
                            >
                              <span>ENTER</span>
                              <ArrowRight className="w-3 h-3" />
                            </Link>

                          )}

                        </td>

                      </tr>
                    );
                  })}

                </tbody>
              </table>

            </div>
          )}

        </div>

        {/* ======================================================
            5. QUICK ACCESS
        ====================================================== */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* Player Sets */}
          <Link
            href="/player-sets"
            className="p-5 rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#C9A227]/50 transition-all shadow-xl group"
          >
            <div className="w-10 h-10 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#C9A227] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Database className="w-5 h-5" />
            </div>

            <h4 className="text-base font-bold text-[#F3F4F1] uppercase font-display tracking-wider mb-1">
              PLAYER SETS
            </h4>

            <p className="text-xs text-[#9CA6A0] leading-relaxed">
              Manage players, roles, base prices, and custom CSV auction sets.
            </p>
          </Link>

          {/* Auction History */}
          <Link
            href="/history"
            className="p-5 rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#C9A227]/50 transition-all shadow-xl group"
          >
            <div className="w-10 h-10 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#E4B93F] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <History className="w-5 h-5" />
            </div>

            <h4 className="text-base font-bold text-[#F3F4F1] uppercase font-display tracking-wider mb-1">
              AUCTION HISTORY
            </h4>

            <p className="text-xs text-[#9CA6A0] leading-relaxed">
              Review past auction sessions, sold player rosters, and final team
              budgets.
            </p>
          </Link>

          {/* Profile */}
          <Link
            href="/profile"
            className="p-5 rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#C9A227]/50 transition-all shadow-xl group"
          >
            <div className="w-10 h-10 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#C9A227] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <User className="w-5 h-5" />
            </div>

            <h4 className="text-base font-bold text-[#F3F4F1] uppercase font-display tracking-wider mb-1">
              PROFILE & SETTINGS
            </h4>

            <p className="text-xs text-[#9CA6A0] leading-relaxed">
              Manage your account identity, display name, and auction
              preferences.
            </p>
          </Link>

        </div>

        {/* ======================================================
            6. AUCTION PROFILE SUMMARY
        ====================================================== */}
        <div className="p-5 sm:p-6 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl">

          <div className="flex items-center space-x-2 mb-4 pb-2 border-b border-[#2A312D]">
            <Sparkles className="w-4 h-4 text-[#C9A227]" />

            <h4 className="text-xs font-bold text-[#9CA6A0] uppercase tracking-wider">
              YOUR AUCTION PROFILE SUMMARY
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">

            {/* Username */}
            <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
              <span className="text-[#9CA6A0] block text-[10px] uppercase font-bold mb-0.5">
                USERNAME
              </span>

              <span className="text-[#F3F4F1] font-bold truncate block">
                {profile?.username || 'N/A'}
              </span>
            </div>

            {/* Email */}
            <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
              <span className="text-[#9CA6A0] block text-[10px] uppercase font-bold mb-0.5">
                EMAIL ADDRESS
              </span>

              <span className="text-[#F3F4F1] truncate block font-mono-numbers">
                {email}
              </span>
            </div>

            {/* Member Since */}
            <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
              <span className="text-[#9CA6A0] block text-[10px] uppercase font-bold mb-0.5">
                MEMBER SINCE
              </span>

              <span className="text-[#F3F4F1] block font-mono-numbers">
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString()
                  : 'N/A'}
              </span>
            </div>

            {/* Total Rooms */}
            <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
              <span className="text-[#9CA6A0] block text-[10px] uppercase font-bold mb-0.5">
                TOTAL ROOMS CREATED
              </span>

              <span className="text-[#E4B93F] font-black font-mono-numbers block text-sm">
                {totalRoomsCount} ROOMS
              </span>
            </div>

          </div>
        </div>

      </main>

      {/* Broadcast Footer */}
      <footer className="py-4 border-t border-[#2A312D]/60 text-center relative z-10 mt-auto">
        <p className="text-[11px] font-mono-numbers text-[#9CA6A0] tracking-wider uppercase">
          MEGA AUCTION ARENA &bull; CONTROL CENTER v1.0
        </p>
      </footer>

    </div>
  );
}