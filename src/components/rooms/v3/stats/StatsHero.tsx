import React from 'react';

export function StatsHero() {
  return (
    <div className="relative overflow-hidden bg-[#0A0D0B] border-b border-[#2A312D] px-4 sm:px-6 lg:px-8 py-12 md:py-20 mb-8 animate-in fade-in duration-1000">
      {/* Background gradients */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#C9A227]/10 to-transparent opacity-50" />
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-[#C9A227]/5 to-transparent blur-3xl opacity-30" />

      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center space-x-3 mb-6">
          <div className="h-px w-8 bg-[#C9A227]" />
          <span className="text-xs font-mono font-bold text-[#C9A227] uppercase tracking-[0.3em]">
            V3 Mega Auction
          </span>
        </div>

        <h1 className="text-4xl md:text-6xl lg:text-7xl font-black font-display text-[#F3F4F1] uppercase tracking-tighter leading-none mb-6">
          Auction <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#C9A227] to-[#E4B93F]">Intelligence</span>
        </h1>

        <p className="max-w-2xl text-lg md:text-xl text-[#9CA6A0] font-medium leading-relaxed">
          Comprehensive post-auction analysis, franchise deployment metrics, and premium battle statistics.
        </p>
      </div>
    </div>
  );
}
