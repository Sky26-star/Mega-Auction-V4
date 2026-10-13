'use client';

// src/app/(dashboard)/teams/page.tsx
// Mega Auction Team Dashboard UI — Pure Flexbox Learning Demonstration Page

import React from 'react';
import Link from 'next/link';
import './teams-flexbox.css';
import {
  Gavel,
  Trophy,
  Users,
  Coins,
  ArrowRight,
  Sparkles,
  Shield,
  LogOut,
  ChevronRight,
  Play,
  Grid,
} from 'lucide-react';

interface TeamData {
  id: string;
  name: string;
  shortCode: string;
  primaryColor: string;
  purse: string;
  bought: number;
  remaining: number;
  status: 'SQUAD READY' | 'BUILDING SQUAD';
  city: string;
}

const TEAMS_DATA: TeamData[] = [
  {
    id: 'csk',
    name: 'Chennai Super Kings',
    shortCode: 'CSK',
    primaryColor: '#E4B93F', // Gold / Yellow
    purse: '₹45.50 Cr',
    bought: 18,
    remaining: 7,
    status: 'SQUAD READY',
    city: 'Chennai',
  },
  {
    id: 'rcb',
    name: 'Royal Challengers',
    shortCode: 'RCB',
    primaryColor: '#B8322E', // Auction Crimson
    purse: '₹32.00 Cr',
    bought: 19,
    remaining: 6,
    status: 'SQUAD READY',
    city: 'Bengaluru',
  },
  {
    id: 'mi',
    name: 'Mumbai Indians',
    shortCode: 'MI',
    primaryColor: '#2563EB', // Neon Blue
    purse: '₹28.50 Cr',
    bought: 20,
    remaining: 5,
    status: 'SQUAD READY',
    city: 'Mumbai',
  },
  {
    id: 'srh',
    name: 'Sunrisers Hyderabad',
    shortCode: 'SRH',
    primaryColor: '#F97316', // Orange
    purse: '₹51.00 Cr',
    bought: 16,
    remaining: 9,
    status: 'BUILDING SQUAD',
    city: 'Hyderabad',
  },
  {
    id: 'kkr',
    name: 'Kolkata Knight Riders',
    shortCode: 'KKR',
    primaryColor: '#8B5CF6', // Purple Accent
    purse: '₹39.50 Cr',
    bought: 17,
    remaining: 8,
    status: 'SQUAD READY',
    city: 'Kolkata',
  },
  {
    id: 'rr',
    name: 'Rajasthan Royals',
    shortCode: 'RR',
    primaryColor: '#EC4899', // Pink Accent
    purse: '₹41.00 Cr',
    bought: 17,
    remaining: 8,
    status: 'SQUAD READY',
    city: 'Jaipur',
  },
];

export default function TeamsDashboardPage() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col relative overflow-x-hidden selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      
      {/* Background Stadium Glow Elements */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-25">
        <div className="absolute -top-40 left-1/4 w-[700px] h-[700px] bg-[#C9A227]/10 rounded-full blur-[180px]" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-[#B8322E]/10 rounded-full blur-[180px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#2A312D_1px,transparent_1px)] [background-size:32px_32px] opacity-25" />
      </div>

      {/* ====================================================================
          1. TOP NAVBAR (Flexbox Container: display: flex, justify-content: space-between)
          ==================================================================== */}
      <header className="w-full bg-[#141917]/90 border-b border-[#2A312D] backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex-nav-container">
          
          {/* Brand Logo & Title Group */}
          <Link href="/dashboard" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 rounded-xl bg-[#0B0F0D] border-2 border-[#C9A227] flex items-center justify-center text-[#E4B93F] shadow-md shadow-[#C9A227]/20 group-hover:scale-105 transition-transform">
              <Gavel className="w-5 h-5 text-[#C9A227]" />
            </div>
            <div>
              <span className="text-sm font-black font-display uppercase tracking-widest text-[#F3F4F1] block leading-none">
                MEGA AUCTION <span className="text-[#C9A227]">ARENA</span>
              </span>
              <span className="text-[10px] font-mono-numbers font-bold text-[#9CA6A0] tracking-widest uppercase block mt-0.5">
                FRANCHISE MANAGEMENT
              </span>
            </div>
          </Link>

          {/* Navigation Links Group (Flex Container: display: flex, align-items: center) */}
          <nav className="flex-nav-links" aria-label="Main Navigation">
            <Link
              href="/dashboard"
              className="text-xs font-bold uppercase tracking-wider text-[#9CA6A0] hover:text-[#F3F4F1] px-3 py-1.5 rounded-lg hover:bg-[#181E1A] transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/teams"
              className="text-xs font-bold uppercase tracking-wider text-[#E4B93F] bg-[#C9A227]/15 border border-[#C9A227]/40 px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1.5"
            >
              <Trophy className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>Teams</span>
            </Link>
            <Link
              href="/player-sets"
              className="text-xs font-bold uppercase tracking-wider text-[#9CA6A0] hover:text-[#F3F4F1] px-3 py-1.5 rounded-lg hover:bg-[#181E1A] transition-colors"
            >
              Players
            </Link>
            <Link
              href="/rooms"
              className="text-xs font-bold uppercase tracking-wider text-[#9CA6A0] hover:text-[#F3F4F1] px-3 py-1.5 rounded-lg hover:bg-[#181E1A] transition-colors"
            >
              Auction
            </Link>
            <Link
              href="/profile"
              className="text-xs font-bold uppercase tracking-wider text-[#9CA6A0] hover:text-[#F3F4F1] px-3 py-1.5 rounded-lg hover:bg-[#181E1A] transition-colors"
            >
              Profile
            </Link>

            {/* Logout Button */}
            <Link
              href="/login"
              className="text-xs font-bold uppercase tracking-wider text-[#B8322E] hover:text-white px-3 py-1.5 rounded-lg hover:bg-[#B8322E]/20 border border-[#B8322E]/40 transition-colors flex items-center space-x-1 ml-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Dashboard Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 relative z-10">

        {/* ====================================================================
            2. HERO / HEADER SECTION (Flexbox Container: display: flex, flex-direction: column)
            ==================================================================== */}
        <section className="p-6 sm:p-8 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-2xl relative overflow-hidden flex-hero-container">
          <div className="flex-badge-container">
            <span className="px-3 py-1 rounded-full bg-[#C9A227]/15 border border-[#C9A227]/40 text-[#E4B93F] text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>● LIVE AUCTION READY</span>
            </span>
            <span className="text-xs font-mono-numbers font-bold text-[#9CA6A0] uppercase bg-[#0B0F0D] px-2.5 py-1 rounded border border-[#2A312D]">
              FLEXBOX DEMO UI
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#F3F4F1] font-display uppercase tracking-tight leading-none mt-1">
            AUCTION <span className="text-[#C9A227]">TEAMS</span>
          </h1>

          <p className="text-xs sm:text-sm text-[#9CA6A0] max-w-2xl leading-relaxed">
            Manage your squads, track your purse and prepare for the upcoming auction. Every section on this dashboard demonstrates core CSS Flexbox layout principles.
          </p>
        </section>

        {/* ====================================================================
            3. TEAM CARDS SECTION (Flex Container: display: flex, flex-wrap: wrap, gap: 1.5rem)
            ==================================================================== */}
        <section className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#2A312D]">
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 text-[#C9A227]" />
              <h2 className="text-base font-extrabold text-[#F3F4F1] uppercase font-display tracking-wider">
                REGISTERED FRANCHISES (6 TEAMS)
              </h2>
            </div>
            <span className="text-xs font-mono-numbers text-[#9CA6A0]">
              PURSE CAP: ₹100.00 Cr
            </span>
          </div>

          {/* Flex Cards Wrapper Container */}
          <div className="flex-card-wrapper">
            {TEAMS_DATA.map((team) => (
              /* Flex Item (Card): flex-grow: 1, flex-shrink: 1, flex-basis: 340px */
              <div
                key={team.id}
                className="flex-team-card p-6 rounded-2xl bg-[#141917] border-2 border-[#2A312D] hover:border-[#C9A227]/60 shadow-xl hover:shadow-2xl hover:shadow-black/80 transition-all duration-300 group"
              >
                {/* Card Header (Flex Container: display: flex, justify-content: space-between) */}
                <div className="flex-card-header">
                  <div className="flex-card-title-group">
                    {/* Team Visual Badge Placeholder */}
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-md border-2 border-white/20 group-hover:scale-105 transition-transform"
                      style={{ backgroundColor: team.primaryColor }}
                    >
                      {team.shortCode}
                    </div>

                    <div>
                      <h3 className="text-lg font-black text-[#F3F4F1] uppercase font-display leading-snug group-hover:text-[#E4B93F] transition-colors">
                        {team.name}
                      </h3>
                      <span className="text-[11px] font-mono-numbers font-semibold text-[#9CA6A0] uppercase">
                        {team.city} Franchise
                      </span>
                    </div>
                  </div>

                  {/* Team Short Code Badge */}
                  <span
                    className="px-2.5 py-1 rounded-lg text-xs font-black font-mono-numbers uppercase tracking-wider border shadow-sm"
                    style={{
                      backgroundColor: `${team.primaryColor}20`,
                      color: team.primaryColor,
                      borderColor: `${team.primaryColor}60`,
                    }}
                  >
                    {team.shortCode}
                  </span>
                </div>

                {/* Card Stats Body (Flex Container: display: flex, flex-direction: column) */}
                <div className="flex-card-stats bg-[#0B0F0D] p-4 rounded-xl border border-[#2A312D]">
                  
                  {/* Purse Row */}
                  <div className="flex-stat-row">
                    <span className="text-xs text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
                      <Coins className="w-3.5 h-3.5 text-[#E4B93F]" />
                      <span>REMAINING PURSE:</span>
                    </span>
                    <span className="text-sm font-black font-mono-numbers text-[#E4B93F]">
                      {team.purse}
                    </span>
                  </div>

                  {/* Players Bought Row */}
                  <div className="flex-stat-row">
                    <span className="text-xs text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
                      <Users className="w-3.5 h-3.5 text-[#C9A227]" />
                      <span>PLAYERS BOUGHT:</span>
                    </span>
                    <span className="text-xs font-bold font-mono-numbers text-[#F3F4F1]">
                      {team.bought} / 25
                    </span>
                  </div>

                  {/* Players Remaining Row */}
                  <div className="flex-stat-row">
                    <span className="text-xs text-[#9CA6A0] font-semibold flex items-center space-x-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
                      <span>SLOTS REMAINING:</span>
                    </span>
                    <span className="text-xs font-bold font-mono-numbers text-[#3B82F6]">
                      {team.remaining} Slots
                    </span>
                  </div>

                  {/* Squad Status Row */}
                  <div className="flex-stat-row pt-2 border-t border-[#2A312D]/60 mt-1">
                    <span className="text-[11px] text-[#9CA6A0] font-semibold uppercase">
                      STATUS:
                    </span>
                    <span className="text-[11px] font-black font-mono-numbers text-emerald-400 flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>{team.status}</span>
                    </span>
                  </div>

                </div>

                {/* Card Action Footer Button */}
                <button
                  type="button"
                  className="w-full py-3 px-4 rounded-xl bg-[#181E1A] hover:bg-[#C9A227] text-[#F3F4F1] hover:text-[#0B0F0D] font-bold text-xs uppercase tracking-wider border border-[#2A312D] hover:border-[#C9A227] transition-all duration-200 flex items-center justify-center space-x-2 group/btn"
                >
                  <span>VIEW SQUAD</span>
                  <ChevronRight className="w-4 h-4 text-[#C9A227] group-hover/btn:text-[#0B0F0D] group-hover/btn:translate-x-0.5 transition-all" />
                </button>

              </div>
            ))}
          </div>
        </section>

        {/* ====================================================================
            4. BOTTOM ACTION AREA (Flex Container: display: flex, justify-content: space-between)
            ==================================================================== */}
        <section className="p-6 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-xl flex-action-bar">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#F3F4F1] uppercase font-display">
                FLEXBOX ACTION BAR
              </h3>
              <p className="text-xs text-[#9CA6A0]">
                Aligned cleanly using justify-content: space-between and flex-wrap.
              </p>
            </div>
          </div>

          {/* Button Group (Flex Container: display: flex, gap: 1rem) */}
          <div className="flex-button-group">
            <Link
              href="/rooms"
              className="py-3.5 px-6 rounded-xl bg-[#181E1A] hover:bg-[#2A312D] border border-[#2A312D] text-[#F3F4F1] text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-colors"
            >
              <Grid className="w-4 h-4 text-[#C9A227]" />
              <span>VIEW ALL TEAMS</span>
            </Link>

            <Link
              href="/rooms/create"
              className="py-3.5 px-6 rounded-xl bg-[#B8322E] hover:bg-[#9B2825] border border-[#B8322E]/60 text-white text-xs font-bold uppercase tracking-widest shadow-lg shadow-[#B8322E]/20 flex items-center space-x-2 transition-colors"
            >
              <Play className="w-4 h-4 text-white fill-white" />
              <span>START AUCTION</span>
            </Link>
          </div>
        </section>

      </main>

      {/* Broadcast Footer */}
      <footer className="py-4 border-t border-[#2A312D]/60 text-center relative z-10 mt-auto">
        <p className="text-[11px] font-mono-numbers text-[#9CA6A0] tracking-wider uppercase">
          MEGA AUCTION ARENA &bull; PURE FLEXBOX LAYOUT PRACTICE UI v1.0
        </p>
      </footer>
    </div>
  );
}
