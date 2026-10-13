'use client';

// src/components/auth/auction-gavel-hero.tsx
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface AuctionGavelHeroProps {
  closingStrikeTrigger?: boolean;
}

export function AuctionGavelHero({ closingStrikeTrigger = false }: AuctionGavelHeroProps) {
  const [struck, setStruck] = useState(false);
  const [closingStruck, setClosingStruck] = useState(false);

  // Opening Intro Strike on Page Mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setStruck(true);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Closing Strike when triggered by Demo Timer hitting 0
  useEffect(() => {
    if (closingStrikeTrigger) {
      setClosingStruck(false);
      const timer = setTimeout(() => {
        setClosingStruck(true);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setClosingStruck(false);
    }
  }, [closingStrikeTrigger]);

  const activeImpact = closingStruck || struck;

  return (
    <div className="w-full flex flex-col items-center lg:items-start space-y-4 select-none relative z-10">
      
      {/* Stadium Floodlight Backdrop Ambient Spotlight */}
      <div className="relative w-full max-w-xl mx-auto lg:mx-0 py-2 px-2 flex flex-col items-center justify-center overflow-hidden">
        
        {/* Ambient Floodlight Beam */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-96 h-96 bg-[radial-gradient(ellipse_at_top,rgba(201,162,39,0.25)_0%,rgba(11,15,13,0)_70%)] pointer-events-none blur-2xl" />

        {/* Floating Ambient Sparkles / Particles */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-40">
          <div className="absolute top-6 left-1/4 w-1.5 h-1.5 rounded-full bg-[#E4B93F] animate-ping" style={{ animationDuration: '3.5s' }} />
          <div className="absolute top-12 right-1/4 w-2 h-2 rounded-full bg-[#C9A227] animate-pulse" />
          <div className="absolute bottom-2 left-1/3 w-1.5 h-1.5 rounded-full bg-[#E4B93F] animate-float-gentle" />
        </div>

        {/* -------------------------------------------------------------
            ANIMATED GAVEL & PODIUM SCENE (SCALED UP FOR DESKTOP)
           ------------------------------------------------------------- */}
        <div className="relative w-72 h-48 sm:w-88 sm:h-56 flex items-center justify-center">
          
          {/* PODIUM BASE & SHOCKWAVE */}
          <motion.div
            className="absolute bottom-2 w-52 h-14 sm:w-64 sm:h-16 rounded-full bg-gradient-to-b from-[#1E2521] via-[#141917] to-[#0B0F0D] border-2 border-[#C9A227]/50 shadow-[0_10px_30px_rgba(0,0,0,0.9)] flex items-center justify-center"
            animate={
              activeImpact
                ? {
                    x: [0, -4, 4, -2, 2, 0],
                    borderColor: ['rgba(201,162,39,0.5)', 'rgba(228,185,63,1)', 'rgba(201,162,39,0.5)'],
                  }
                : {}
            }
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {/* Podium Surface Inner Ring */}
            <div className="w-[88%] h-[75%] rounded-full border border-[#C9A227]/30 bg-[#0E1311] shadow-inner flex items-center justify-center">
              <div className="w-[72%] h-[62%] rounded-full bg-gradient-to-br from-[#161C19] to-[#0A0D0B] border border-[#C9A227]/20 flex items-center justify-center">
                <span className="text-[9px] font-mono-numbers font-bold text-[#C9A227]/40 tracking-widest uppercase">
                  AUCTION PODIUM
                </span>
              </div>
            </div>

            {/* Impact Flash Ring / Radial Shockwave */}
            {activeImpact && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-[#E4B93F] bg-[#C9A227]/30 pointer-events-none"
                initial={{ scale: 0.4, opacity: 1 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ duration: 0.65, ease: 'easeOut' }}
              />
            )}

            {/* Impact Spark Particles */}
            {activeImpact && (
              <>
                <motion.span
                  className="absolute w-2 h-2 rounded-full bg-[#E4B93F] shadow-[0_0_10px_#E4B93F]"
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: -36, y: -28, opacity: 0 }}
                  transition={{ duration: 0.45 }}
                />
                <motion.span
                  className="absolute w-2 h-2 rounded-full bg-[#E4B93F] shadow-[0_0_10px_#E4B93F]"
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: 36, y: -30, opacity: 0 }}
                  transition={{ duration: 0.45 }}
                />
                <motion.span
                  className="absolute w-1.5 h-1.5 rounded-full bg-[#FFFFFF] shadow-[0_0_8px_#FFF]"
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: 0, y: -40, opacity: 0 }}
                  transition={{ duration: 0.4 }}
                />
                <motion.span
                  className="absolute w-2 h-2 rounded-full bg-[#B8322E] shadow-[0_0_10px_#B8322E]"
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: -50, y: -14, opacity: 0 }}
                  transition={{ duration: 0.5 }}
                />
                <motion.span
                  className="absolute w-2 h-2 rounded-full bg-[#C9A227] shadow-[0_0_10px_#C9A227]"
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: 52, y: -16, opacity: 0 }}
                  transition={{ duration: 0.5 }}
                />
              </>
            )}
          </motion.div>

          {/* GAVEL SVG (PROMINENTLY SCALED UP) */}
          <motion.div
            className="absolute top-0 w-36 h-36 sm:w-44 sm:h-44 z-20 pointer-events-none"
            initial={{ rotate: -36, y: -30, x: -16 }}
            animate={
              activeImpact
                ? {
                    rotate: [ -36, 0, -5, 0 ],
                    y: [ -30, 10, 5, 8 ],
                    x: [ -16, 0, 0, 0 ],
                  }
                : {}
            }
            transition={{
              duration: 0.55,
              times: [0, 0.7, 0.85, 1],
              ease: ['easeIn', 'easeOut', 'easeInOut'],
            }}
          >
            {/* Gavel Subtle Ambient Float Post-Strike */}
            <motion.div
              animate={struck ? { y: [0, -4, 0] } : {}}
              transition={{
                duration: 4,
                repeat: Infinity,
                repeatType: 'reverse',
                ease: 'easeInOut',
                delay: 0.8,
              }}
              className="w-full h-full"
            >
              <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-[0_16px_32px_rgba(0,0,0,0.9)]">
                <defs>
                  {/* Metallic Gold Gradients */}
                  <linearGradient id="gavelGoldHead" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FFF4B8" />
                    <stop offset="30%" stopColor="#E4B93F" />
                    <stop offset="70%" stopColor="#C9A227" />
                    <stop offset="100%" stopColor="#7A5C0F" />
                  </linearGradient>

                  <linearGradient id="gavelBrassRing" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="50%" stopColor="#E4B93F" />
                    <stop offset="100%" stopColor="#8A6614" />
                  </linearGradient>

                  <linearGradient id="gavelWoodHandle" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3A2C1E" />
                    <stop offset="50%" stopColor="#221A12" />
                    <stop offset="100%" stopColor="#0F0C08" />
                  </linearGradient>

                  <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Wooden Handle */}
                <path
                  d="M100 105 L158 163 C162 167 168 167 172 163 L177 158 C181 154 181 148 177 144 L119 86 Z"
                  fill="url(#gavelWoodHandle)"
                  stroke="#C9A227"
                  strokeWidth="1.8"
                  strokeOpacity="0.6"
                />

                {/* Handle Brass End Cap */}
                <path
                  d="M168 159 L175 152 C178 149 178 145 175 142 L170 137 L155 152 L160 157 C163 160 165 160 168 159 Z"
                  fill="url(#gavelBrassRing)"
                />

                {/* Gavel Head Main Cylinder */}
                <rect
                  x="48"
                  y="62"
                  width="78"
                  height="46"
                  rx="7"
                  transform="rotate(-25 87 85)"
                  fill="url(#gavelGoldHead)"
                  filter="url(#goldGlow)"
                  stroke="#FFE9A3"
                  strokeWidth="1.5"
                />

                {/* Left Brass Ring */}
                <rect
                  x="52"
                  y="61"
                  width="11"
                  height="48"
                  rx="2"
                  transform="rotate(-25 57 85)"
                  fill="url(#gavelBrassRing)"
                />

                {/* Right Brass Ring */}
                <rect
                  x="110"
                  y="61"
                  width="11"
                  height="48"
                  rx="2"
                  transform="rotate(-25 115 85)"
                  fill="url(#gavelBrassRing)"
                />

                {/* Left Striking Face */}
                <ellipse
                  cx="44"
                  cy="73"
                  rx="7"
                  ry="21"
                  transform="rotate(-25 44 73)"
                  fill="url(#gavelBrassRing)"
                  stroke="#FFFFFF"
                  strokeWidth="1"
                />

                {/* Right Striking Face */}
                <ellipse
                  cx="128"
                  cy="112"
                  rx="7"
                  ry="21"
                  transform="rotate(-25 128 112)"
                  fill="url(#gavelGoldHead)"
                />

                {/* Center Neck Collar */}
                <circle cx="92" cy="98" r="9" fill="url(#gavelBrassRing)" />
              </svg>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* -------------------------------------------------------------
          BRAND TYPOGRAPHY REVEAL (LARGE & DOMINANT FOR DESKTOP)
         ------------------------------------------------------------- */}
      <div className="w-full text-center lg:text-left space-y-3">
        
        {/* Real HTML/CSS Typography Reveal */}
        <h1 className="text-4xl sm:text-5xl xl:text-6xl font-black tracking-tight uppercase leading-none font-display flex flex-wrap items-center justify-center lg:justify-start gap-x-3.5 gap-y-1">
          
          {/* WORD 1: MEGA */}
          <motion.span
            className="bg-gradient-to-b from-[#FFF4B8] via-[#E4B93F] to-[#C9A227] bg-clip-text text-transparent drop-shadow-[0_4px_16px_rgba(201,162,39,0.35)] inline-block"
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={struck ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.45, delay: 0.1, ease: 'easeOut' }}
          >
            MEGA
          </motion.span>

          {/* WORD 2: AUCTION */}
          <motion.span
            className="text-[#F3F4F1] drop-shadow-lg inline-block"
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={struck ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.45, delay: 0.25, ease: 'easeOut' }}
          >
            AUCTION
          </motion.span>

          {/* WORD 3: ARENA */}
          <motion.span
            className="text-[#B8322E] drop-shadow-[0_0_20px_rgba(184,50,46,0.55)] inline-block"
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={struck ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.45, delay: 0.4, ease: 'easeOut' }}
          >
            ARENA
          </motion.span>
        </h1>

        {/* Signature Live Auction Status Line (Unique Feature) */}
        <motion.div
          className="inline-flex items-center space-x-3 px-4 py-1.5 rounded-full bg-[#141917] border border-[#C9A227]/40 text-xs font-mono-numbers font-semibold shadow-md"
          initial={{ opacity: 0, y: 10 }}
          animate={struck ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, delay: 0.55 }}
        >
          <div className="flex items-center space-x-1.5 text-[#B8322E] font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-[#B8322E] animate-pulse-live" />
            <span className="tracking-wider uppercase text-[11px]">LIVE AUCTION</span>
          </div>
          <span className="text-[#2A312D]">•</span>
          <span className="text-[#E4B93F] tracking-wide">ROOM 07</span>
          <span className="text-[#2A312D]">•</span>
          <span className="text-[#9CA6A0] tracking-wide">LOT #014</span>
        </motion.div>

        {/* Tagline */}
        <motion.p
          className="text-xs sm:text-sm text-[#9CA6A0] max-w-xl mx-auto lg:mx-0 leading-relaxed font-medium"
          initial={{ opacity: 0 }}
          animate={struck ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.65 }}
        >
          REAL-TIME CRICKET AUCTION SIMULATOR. Draft your dream XI against friends or AI franchises in synchronized, high-stakes bidding rooms.
        </motion.p>
      </div>

    </div>
  );
}
