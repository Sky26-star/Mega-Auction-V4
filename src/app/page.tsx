import React from 'react';
import Link from 'next/link';
import { Gavel } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col">
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full bg-[#C9A227]/10 border border-[#C9A227]/20 px-5 py-2 text-xs font-bold text-[#E4B93F] uppercase tracking-widest">
            <Gavel className="w-4 h-4" />
            <span>Mega Auction Arena</span>
          </div>

          {/* Heading */}
          <h1 className="mt-8 text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white">
            Run your own
            <span className="block text-[#E4B93F]">
              Sports Auctions
            </span>
            <span className="block">
              with Friends.
            </span>
          </h1>

          {/* Description */}
          <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-[#9CA6A0]">
            Create your own live player auction, invite your friends,
            build your squad, manage your purse, and experience
            real-time competitive bidding.
          </p>

          {/* CTA */}
          <div className="mt-10 flex justify-center">
            <Link
              href="/login"
              className="group inline-flex items-center gap-3 rounded-xl bg-[#B8322E] px-8 py-4 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-[#B8322E]/20 transition-all hover:bg-[#9B2825] hover:scale-[1.02]"
            >
              <Gavel className="w-5 h-5 transition-transform group-hover:rotate-[-8deg]" />
              <span>Enter the Auction</span>
            </Link>
          </div>

          {/* Supporting text */}
          <p className="mt-5 text-xs uppercase tracking-widest text-[#68716B]">
            Free • Real-Time • Multiplayer
          </p>

        </div>
      </main>

      <footer className="border-t border-[#2A312D]/60 py-4 text-center">
        <p className="text-[10px] font-bold tracking-widest text-[#68716B] uppercase">
          Mega Auction Arena • Official Cricket Auction Interface
        </p>
      </footer>
    </div>
  );
}