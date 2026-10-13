'use client';

// src/app/docs/page.tsx
// Official Auction Guide & Rules Documentation for Mega Auction V3

import React from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import {
  Gavel,
  Clock,
  Shield,
  Wallet,
  Users,
  BarChart3,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Trophy,
  Sparkles,
  ArrowRight,
  BookOpen,
  Layers,
  Info,
  ChevronRight,
} from 'lucide-react';

export default function DocumentationPage() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col font-sans selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Header Hero */}
        <div className="mb-10 sm:mb-14 border-b border-[#2A312D] pb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#C9A227]/10 border border-[#C9A227]/30 px-3.5 py-1 text-xs font-mono font-bold text-[#E4B93F] uppercase tracking-wider mb-4">
            <BookOpen className="w-3.5 h-3.5 text-[#E4B93F]" />
            <span>Official Rulebook &amp; User Manual</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase text-[#F3F4F1] font-display tracking-tight">
            Auction Guide &amp; <span className="text-[#C9A227]">Tournament Rules</span>
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[#9CA6A0] max-w-3xl leading-relaxed">
            Complete authoritative reference for Mega Auction V3. Learn how room configurations,
            tiered bidding ladders, financial reserves, roster constraints, and the Mini Auction system work.
          </p>

          {/* Quick Table of Contents Bar */}
          <nav aria-label="Table of contents" className="mt-8 flex flex-wrap gap-2 sm:gap-3">
            {[
              { id: 'how-to-play', label: '1. How to Play', icon: Gavel },
              { id: 'bidding-rules', label: '2. Bidding Rules', icon: Clock },
              { id: 'purse-and-squad', label: '3. Purse & Roster', icon: Wallet },
              { id: 'room-settings', label: '4. Room Settings', icon: Layers },
              { id: 'unsold-and-mini', label: '5. Mini Auction', icon: Sparkles },
              { id: 'troubleshooting-faq', label: '6. FAQ & Help', icon: HelpCircle },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141917] border border-[#2A312D] hover:border-[#C9A227]/50 hover:bg-[#1E2522] text-xs font-mono font-medium text-[#9CA6A0] hover:text-[#F3F4F1] transition-all"
                >
                  <Icon className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
        </div>

        <div className="space-y-16">
          {/* ══════════════════════════════════════════════════════
              SECTION 1: WELCOME & HOW TO PLAY
              ══════════════════════════════════════════════════════ */}
          <section id="how-to-play" className="scroll-mt-24 space-y-6">
            <div className="flex items-center gap-3 border-b border-[#2A312D] pb-3">
              <div className="w-8 h-8 rounded-lg bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center text-[#E4B93F]">
                <Gavel className="w-4 h-4" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-[#F3F4F1] font-display tracking-wide">
                1. Welcome &amp; How to Play
              </h2>
            </div>

            <p className="text-sm sm:text-base text-[#9CA6A0] leading-relaxed">
              Mega Auction Arena provides a real-time multiplayer cricket auction simulation where human managers
              and strategic AI bot franchises compete to assemble competitive squads within purse and roster bounds.
            </p>

            <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-5 sm:p-7 space-y-6">
              <h3 className="text-sm font-mono font-bold text-[#E4B93F] uppercase tracking-wider">
                Authoritative Auction Lifecycle Flow
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-[#0B0F0D] border border-[#2A312D] rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#C9A227]">
                    <span>STAGE 1</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#C9A227]/10">LOBBY</span>
                  </div>
                  <h4 className="text-base font-bold text-[#F3F4F1]">Room Assembly</h4>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    The host configures room parameters (purse, squad limit, timer, player pool) and invites managers.
                    Managers select franchise identities and prepare for the draft.
                  </p>
                </div>

                <div className="bg-[#0B0F0D] border border-[#2A312D] rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#C9A227]">
                    <span>STAGE 2</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#C9A227]/10">GET READY</span>
                  </div>
                  <h4 className="text-base font-bold text-[#F3F4F1]">Incoming Lot (5s)</h4>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    Before bidding opens on each player, a fixed 5-second countdown gives all managers time
                    to review player stats, career records, role classification, and base price.
                  </p>
                </div>

                <div className="bg-[#0B0F0D] border border-[#2A312D] rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#C9A227]">
                    <span>STAGE 3</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#C9A227]/10">BIDDING</span>
                  </div>
                  <h4 className="text-base font-bold text-[#F3F4F1]">Live Bidding Window</h4>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    Managers place bids according to the authoritative increment ladder. Each valid incoming bid
                    resets the countdown timer, ensuring fair competition against clock-sniping.
                  </p>
                </div>

                <div className="bg-[#0B0F0D] border border-[#2A312D] rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#C9A227]">
                    <span>STAGE 4</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#C9A227]/10">RESOLUTION</span>
                  </div>
                  <h4 className="text-base font-bold text-[#F3F4F1]">SOLD or UNSOLD</h4>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    If the timer reaches zero with active bids, the player is marked SOLD to the leading bidder and
                    added to their squad. If zero bids occur, the player is recorded as UNSOLD.
                  </p>
                </div>

                <div className="bg-[#0B0F0D] border border-[#2A312D] rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#C9A227]">
                    <span>STAGE 5</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#C9A227]/10">MINI ROUND</span>
                  </div>
                  <h4 className="text-base font-bold text-[#F3F4F1]">Mini Auction (Conditional)</h4>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    When all primary lots conclude, if unsold players remain and teams still have squad slots and
                    purse available, an accelerated nomination round can be triggered.
                  </p>
                </div>

                <div className="bg-[#0B0F0D] border border-[#2A312D] rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-[#C9A227]">
                    <span>STAGE 6</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#C9A227]/10">SUMMARY</span>
                  </div>
                  <h4 className="text-base font-bold text-[#F3F4F1]">Roster Analysis</h4>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    After final lot completion, franchises can analyze final purse spending, top acquisitions, role
                    distributions, and team rosters on the summary dashboard.
                  </p>
                </div>
              </div>

              {/* Roles: Host vs Participant */}
              <div className="border-t border-[#2A312D] pt-5">
                <h4 className="text-xs font-mono font-bold text-[#9CA6A0] uppercase tracking-wider mb-3">
                  Permissions &amp; Actions During Live Auction
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] space-y-1.5">
                    <span className="font-mono font-bold text-[#E4B93F] uppercase">Room Host Controls:</span>
                    <p className="text-[#9CA6A0]">
                      Hosts can initialize the auction from the lobby, temporarily pause the live room if managers
                      need a break, and initiate the 3-second resume countdown.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] space-y-1.5">
                    <span className="font-mono font-bold text-[#F3F4F1] uppercase">Franchise Manager Actions:</span>
                    <p className="text-[#9CA6A0]">
                      Managers can click <strong className="text-[#F3F4F1]">Place Bid</strong> during the active
                      bidding countdown whenever their franchise meets purse and roster eligibility criteria.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════
              SECTION 2: BIDDING RULES & INCREMENT LADDER
              ══════════════════════════════════════════════════════ */}
          <section id="bidding-rules" className="scroll-mt-24 space-y-6">
            <div className="flex items-center gap-3 border-b border-[#2A312D] pb-3">
              <div className="w-8 h-8 rounded-lg bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center text-[#E4B93F]">
                <Clock className="w-4 h-4" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-[#F3F4F1] font-display tracking-wide">
                2. Bidding Rules &amp; Increment Ladder
              </h2>
            </div>

            <p className="text-sm sm:text-base text-[#9CA6A0] leading-relaxed">
              To mirror real-world professional cricket auctions, bids are strictly structured into value tiers.
              The system calculates the authoritative minimum next bid automatically based on the current price.
            </p>

            {/* Increment Ladder Table */}
            <div className="bg-[#141917] border border-[#2A312D] rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 sm:p-5 border-b border-[#2A312D] bg-[#181E1A] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-mono font-bold text-[#E4B93F] uppercase tracking-wider">
                    Authoritative Bid Increment Ladder
                  </h3>
                  <p className="text-xs text-[#9CA6A0] mt-0.5">
                    Enforced by the database engine across human and bot bids.
                  </p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#C9A227]/10 border border-[#C9A227]/30 text-[#E4B93F]">
                  Source: bid-increments.ts &amp; v3_place_bid
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-[#0B0F0D] text-[#9CA6A0] font-mono uppercase text-[10px] tracking-wider border-b border-[#2A312D]">
                    <tr>
                      <th className="py-3 px-4 sm:px-6">Current Bid Slab</th>
                      <th className="py-3 px-4 sm:px-6">Increment Amount</th>
                      <th className="py-3 px-4 sm:px-6">In Words / Units</th>
                      <th className="py-3 px-4 sm:px-6">Next Bid Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A312D] font-mono-numbers">
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 text-[#F3F4F1] font-semibold">Up to ₹3.00 Cr (inclusive)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F] font-bold">+₹0.25 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">25 Lakhs (25L)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">₹1.00 Cr $\rightarrow$ ₹1.25 Cr</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 text-[#F3F4F1] font-semibold">Above ₹3.00 Cr up to ₹6.00 Cr (inclusive)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F] font-bold">+₹0.50 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">50 Lakhs (50L)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">₹4.00 Cr $\rightarrow$ ₹4.50 Cr</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 text-[#F3F4F1] font-semibold">Above ₹6.00 Cr up to ₹10.00 Cr (inclusive)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F] font-bold">+₹0.75 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">75 Lakhs (75L)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">₹7.50 Cr $\rightarrow$ ₹8.25 Cr</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 text-[#F3F4F1] font-semibold">Above ₹10.00 Cr up to ₹15.00 Cr (inclusive)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F] font-bold">+₹1.00 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">1.00 Crore (100L)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">₹12.00 Cr $\rightarrow$ ₹13.00 Cr</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 text-[#F3F4F1] font-semibold">Above ₹15.00 Cr up to ₹20.00 Cr (inclusive)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F] font-bold">+₹1.50 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">1.50 Crores (150L)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">₹16.00 Cr $\rightarrow$ ₹17.50 Cr</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 text-[#F3F4F1] font-semibold">Above ₹20.00 Cr up to ₹25.00 Cr (inclusive)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F] font-bold">+₹1.75 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">1.75 Crores (175L)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">₹21.00 Cr $\rightarrow$ ₹22.75 Cr</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors bg-[#1E2522]/20">
                      <td className="py-3 px-4 sm:px-6 text-[#F3F4F1] font-semibold">Above ₹25.00 Cr (No Upper Limit)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F] font-bold">+₹2.00 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">2.00 Crores (200L)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">₹26.00 Cr $\rightarrow$ ₹28.00 Cr</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Timer Rules */}
            <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#E4B93F] uppercase tracking-wider">
                <Clock className="w-4 h-4" />
                <span>Bidding Countdown &amp; Anti-Sniping Behavior</span>
              </div>
              <ul className="space-y-2.5 text-xs sm:text-sm text-[#9CA6A0] list-disc list-inside leading-relaxed">
                <li>
                  <strong className="text-[#F3F4F1]">Room-Creation Default:</strong> Rooms created via the UI default to
                  a <strong className="text-[#E4B93F]">10-second</strong> countdown timer.
                </li>
                <li>
                  <strong className="text-[#F3F4F1]">Configurable Timer Options:</strong> Room hosts can choose between{' '}
                  <strong className="text-[#F3F4F1]">10s, 15s, or 20s</strong> during room setup.
                </li>
                <li>
                  <strong className="text-[#F3F4F1]">Dynamic Timer Reset:</strong> Whenever an eligible franchise places
                  a bid, the timer resets immediately back to the full configured duration, giving rival franchises
                  fair opportunity to respond.
                </li>
                <li>
                  <strong className="text-[#F3F4F1]">System Fallback:</strong> If a room is unconfigured or loaded from an
                  older preset, the auction ticker falls back gracefully to{' '}
                  <strong className="text-[#F3F4F1]">15 seconds</strong>.
                </li>
              </ul>
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════
              SECTION 3: PURSE, SQUAD & ROSTER RULES
              ══════════════════════════════════════════════════════ */}
          <section id="purse-and-squad" className="scroll-mt-24 space-y-6">
            <div className="flex items-center gap-3 border-b border-[#2A312D] pb-3">
              <div className="w-8 h-8 rounded-lg bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center text-[#E4B93F]">
                <Wallet className="w-4 h-4" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-[#F3F4F1] font-display tracking-wide">
                3. Purse, Squad &amp; Roster Rules
              </h2>
            </div>

            <p className="text-sm sm:text-base text-[#9CA6A0] leading-relaxed">
              Every franchise must adhere to financial solvency and tournament roster quotas. The platform
              strictly enforces overseas caps and squad limits.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#C9A227] uppercase tracking-wider">
                  <Wallet className="w-4 h-4" />
                  <span>Franchise Purse</span>
                </div>
                <div className="text-2xl font-black font-mono-numbers text-[#F3F4F1]">₹100 Cr – ₹150 Cr</div>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  Configurable at room creation in ₹10 Cr increments (100, 110, 120, 130, 140, 150 Cr).
                  Default selection is <strong className="text-[#E4B93F]">₹100 Cr</strong>.
                </p>
              </div>

              <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#C9A227] uppercase tracking-wider">
                  <Users className="w-4 h-4" />
                  <span>Squad Size Capacity</span>
                </div>
                <div className="text-2xl font-black font-mono-numbers text-[#F3F4F1]">15 – 25 Players</div>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  UI creation options are <strong className="text-[#E4B93F]">15, 20, or 25</strong> (default is 15).
                  System validation accepts 11–30 players; legacy rooms fall back to 25.
                </p>
              </div>

              <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#B8322E] uppercase tracking-wider">
                  <Shield className="w-4 h-4" />
                  <span>Overseas Quota</span>
                </div>
                <div className="text-2xl font-black font-mono-numbers text-[#F3F4F1]">Max 8 Overseas</div>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  Fixed tournament limit of <strong className="text-[#E4B93F]">8 overseas players</strong>. Any bid on an
                  overseas player after reaching 8 is rejected by the database.
                </p>
              </div>
            </div>

            {/* Strategic Reserve Formula Callout */}
            <div className="bg-[#141917] border border-[#C9A227]/30 rounded-2xl p-5 sm:p-7 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#E4B93F] animate-pulse"></span>
                  <h3 className="text-sm font-mono font-bold text-[#E4B93F] uppercase tracking-wider">
                    Strategic Reserve &amp; Maximum Bid Calculation
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#181E1A] border border-[#2A312D] text-[#9CA6A0]">
                  Mathematical Strategy Guide
                </span>
              </div>

              <p className="text-xs sm:text-sm text-[#9CA6A0] leading-relaxed">
                To guarantee that a franchise can fill all remaining roster slots without going bankrupt, intelligent
                teams and bot managers calculate a <strong className="text-[#F3F4F1]">Mandatory Financial Reserve</strong>:
              </p>

              <div className="p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D] font-mono text-xs sm:text-sm text-[#F3F4F1] space-y-1.5 leading-relaxed">
                <div className="text-[#9CA6A0]">
                  Remaining Slots = Maximum Squad Size − Players Bought − 1
                </div>
                <div className="text-[#9CA6A0]">
                  Mandatory Reserve = Remaining Slots × Minimum Base Price (audited at ₹20 Lakhs / ₹0.20 Cr)
                </div>
                <div className="text-[#E4B93F] font-bold pt-1">
                  Maximum Strategic Bid = Current Purse − Mandatory Reserve
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#0B0F0D]/60 border border-[#2A312D] flex items-start gap-3">
                <Info className="w-4 h-4 text-[#C9A227] shrink-0 mt-0.5" />
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  <strong className="text-[#F3F4F1]">Important Technical Distinction:</strong> The reserve formula above is
                  calculated by strategic bots to avoid roster bankruptcy. The database engine does not artificially block a
                  human manager from bidding down to their last rupee; instead, the database directly rejects bids if the team
                  has insufficient purse for the next bid, if their squad capacity is reached, or if the overseas cap is breached.
                </p>
              </div>
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════
              SECTION 4: ROOM SETTINGS REFERENCE
              ══════════════════════════════════════════════════════ */}
          <section id="room-settings" className="scroll-mt-24 space-y-6">
            <div className="flex items-center gap-3 border-b border-[#2A312D] pb-3">
              <div className="w-8 h-8 rounded-lg bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center text-[#E4B93F]">
                <Layers className="w-4 h-4" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-[#F3F4F1] font-display tracking-wide">
                4. Room Settings Reference
              </h2>
            </div>

            <p className="text-sm sm:text-base text-[#9CA6A0] leading-relaxed">
              When creating a new auction room, hosts can tailor the tournament parameters to their liking.
              Below is the verified matrix of options and defaults:
            </p>

            <div className="bg-[#141917] border border-[#2A312D] rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-[#0B0F0D] text-[#9CA6A0] font-mono uppercase text-[10px] tracking-wider border-b border-[#2A312D]">
                    <tr>
                      <th className="py-3 px-4 sm:px-6">Parameter</th>
                      <th className="py-3 px-4 sm:px-6">UI Creation Default</th>
                      <th className="py-3 px-4 sm:px-6">Available Options / Range</th>
                      <th className="py-3 px-4 sm:px-6">System Notes &amp; Fallback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A312D] font-mono text-xs">
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 font-bold text-[#F3F4F1]">Starting Purse</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F]">₹100 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">100, 110, 120, 130, 140, 150 Cr</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Validator minimum: 100 Cr</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 font-bold text-[#F3F4F1]">Bidding Timer</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F]">10 Seconds</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">10s, 15s, 20s (UI buttons)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Unconfigured rooms fallback to 15s</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 font-bold text-[#F3F4F1]">Squad Size</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F]">15 Players</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">15, 20, 25 (UI buttons)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Schema range 11–30; fallback is 25</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 font-bold text-[#F3F4F1]">Overseas Limit</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F]">8 Players</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Fixed Tournament Rule (8)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Enforced strictly in database</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 font-bold text-[#F3F4F1]">Bot Opponents</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F]">0 Bots</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">0 to 9 Bots</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Automated AI bidder franchises</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 font-bold text-[#F3F4F1]">Bot Difficulty</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F]">Balanced</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Easy, Balanced, Aggressive</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Controls bot aggression &amp; stretch tolerance</td>
                    </tr>
                    <tr className="hover:bg-[#1E2522]/40 transition-colors">
                      <td className="py-3 px-4 sm:px-6 font-bold text-[#F3F4F1]">Player Pool</td>
                      <td className="py-3 px-4 sm:px-6 text-[#E4B93F]">ALL (Default Pool)</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">ALL, By Category, By Role, Manual</td>
                      <td className="py-3 px-4 sm:px-6 text-[#9CA6A0]">Audited default master dataset: 202 players</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════
              SECTION 5: UNSOLD PLAYERS & MINI AUCTION
              ══════════════════════════════════════════════════════ */}
          <section id="unsold-and-mini" className="scroll-mt-24 space-y-6">
            <div className="flex items-center gap-3 border-b border-[#2A312D] pb-3">
              <div className="w-8 h-8 rounded-lg bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center text-[#E4B93F]">
                <Sparkles className="w-4 h-4" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-[#F3F4F1] font-display tracking-wide">
                5. Unsold Players &amp; Mini Auction
              </h2>
            </div>

            <p className="text-sm sm:text-base text-[#9CA6A0] leading-relaxed">
              If an auction lot expires with zero bids placed, the player is authoritatively recorded as{' '}
              <strong className="text-[#E4B93F]">UNSOLD</strong>. The platform features an intelligent second-chance
              workflow called the <strong className="text-[#F3F4F1]">Mini Auction</strong>.
            </p>

            <div className="bg-[#141917] border border-[#2A312D] rounded-2xl p-5 sm:p-7 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-3 p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                  <h3 className="text-sm font-mono font-bold text-[#C9A227] uppercase tracking-wider">
                    Conditional Mini Auction Activation
                  </h3>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    A Mini Auction is <strong className="text-[#F3F4F1]">not guaranteed for every room</strong>.
                    When all primary lots conclude, the database checks two conditions:
                  </p>
                  <ol className="text-xs text-[#9CA6A0] space-y-1.5 list-decimal list-inside font-mono">
                    <li>One or more players finished as <span className="text-[#E4B93F]">UNSOLD</span>.</li>
                    <li>One or more franchises have remaining squad capacity (<span className="text-[#E4B93F]">players &lt; max</span>) and purse available.</li>
                  </ol>
                  <p className="text-xs text-[#9CA6A0] pt-1">
                    If both conditions are met, the room status transitions to <strong className="text-[#C9A227]">MINI_AUCTION</strong>.
                    Otherwise, the auction immediately concludes as <strong className="text-[#10B981]">COMPLETED</strong>.
                  </p>
                </div>

                <div className="space-y-3 p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
                  <h3 className="text-sm font-mono font-bold text-[#E4B93F] uppercase tracking-wider">
                    Nomination Board &amp; Accelerated Bidding
                  </h3>
                  <p className="text-xs text-[#9CA6A0] leading-relaxed">
                    Inside the Mini Auction:
                  </p>
                  <ul className="text-xs text-[#9CA6A0] space-y-1.5 list-disc list-inside">
                    <li>
                      <strong className="text-[#F3F4F1]">Nomination Board:</strong> Franchises review unsold candidates
                      and nominate players they wish to bring back to the hammer.
                    </li>
                    <li>
                      <strong className="text-[#F3F4F1]">Accelerated Bidding:</strong> Nominated players enter an expedited
                      bidding round using the standard increment ladder.
                    </li>
                    <li>
                      <strong className="text-[#F3F4F1]">Final Transition:</strong> Once all mini auction lots are resolved,
                      the auction transitions to <strong className="text-[#F3F4F1]">COMPLETED</strong>.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════
              SECTION 6: TROUBLESHOOTING & FAQ
              ══════════════════════════════════════════════════════ */}
          <section id="troubleshooting-faq" className="scroll-mt-24 space-y-6">
            <div className="flex items-center gap-3 border-b border-[#2A312D] pb-3">
              <div className="w-8 h-8 rounded-lg bg-[#C9A227]/10 border border-[#C9A227]/30 flex items-center justify-center text-[#E4B93F]">
                <HelpCircle className="w-4 h-4" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-[#F3F4F1] font-display tracking-wide">
                6. Frequently Asked Questions &amp; Troubleshooting
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
              <div className="p-5 rounded-2xl bg-[#141917] border border-[#2A312D] space-y-2">
                <h3 className="text-sm font-bold text-[#F3F4F1] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-[#C9A227] shrink-0" />
                  Why is my Place Bid button disabled?
                </h3>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  The button is disabled if: (1) you are currently the highest bidder, (2) the lot is still in the 5-second
                  Get Ready phase, (3) your purse is smaller than the next minimum bid, (4) your squad has reached its maximum
                  player limit, or (5) the player is overseas and your franchise already has 8 overseas players.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#141917] border border-[#2A312D] space-y-2">
                <h3 className="text-sm font-bold text-[#F3F4F1] flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#C9A227] shrink-0" />
                  What does Get Ready mean?
                </h3>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  Before bidding opens on every player, a mandatory 5-second preparation period appears. Bidding is disabled
                  during this window to allow all managers on different devices to see the new lot and examine stats equally.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#141917] border border-[#2A312D] space-y-2">
                <h3 className="text-sm font-bold text-[#F3F4F1] flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#C9A227] shrink-0" />
                  Why does my timer show 15 seconds instead of 10?
                </h3>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  Room creators can pick 10s, 15s, or 20s at room setup. If a room was created with the 15s option, or was
                  loaded from an unconfigured preset, the platform authoritatively operates at 15 seconds.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#141917] border border-[#2A312D] space-y-2">
                <h3 className="text-sm font-bold text-[#F3F4F1] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#C9A227] shrink-0" />
                  What happens to an unsold player?
                </h3>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  Unsold players are safely preserved in the database. If any teams still have purse and open squad slots
                  at the end of the primary auction, unsold players can be nominated for the Mini Auction round.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#141917] border border-[#2A312D] space-y-2">
                <h3 className="text-sm font-bold text-[#F3F4F1] flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#C9A227] shrink-0" />
                  Where can I view my squad and team statistics?
                </h3>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  During an active auction, use the top navbar links to view your franchise roster at{' '}
                  <span className="font-mono text-[#E4B93F]">/rooms/[id]/squad</span> or view league comparison records at{' '}
                  <span className="font-mono text-[#E4B93F]">/rooms/[id]/stats</span>.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-[#141917] border border-[#2A312D] space-y-2">
                <h3 className="text-sm font-bold text-[#F3F4F1] flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-[#C9A227] shrink-0" />
                  Where can I see post-auction summary results?
                </h3>
                <p className="text-xs text-[#9CA6A0] leading-relaxed">
                  Once the auction concludes, managers can click &apos;VIEW SUMMARY &amp; RESULTS&apos; to open the comprehensive
                  summary at <span className="font-mono text-[#E4B93F]">/rooms/[id]/summary</span>, which includes spending
                  analytics, roster tables, and leaderboard rankings.
                </p>
              </div>
            </div>
          </section>

          {/* Footer Callout */}
          <div className="border-t border-[#2A312D] pt-8 text-center text-xs text-[#68716B]">
            <p className="font-mono uppercase tracking-widest">
              Mega Auction Arena • Official Tournament Specification &amp; User Documentation
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
