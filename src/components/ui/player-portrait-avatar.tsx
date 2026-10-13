'use client';

// src/components/ui/player-portrait-avatar.tsx
// 10/10+ Production Player Portrait & Fail-Safe Neutral Silhouette Avatar System

import React, { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Sparkles, Shield, Trophy } from 'lucide-react';
import { PlayerAuctionStatus } from '@/types/player';

interface PlayerPortraitAvatarProps {
  name: string;
  imageUrl?: string | null;
  status?: PlayerAuctionStatus;
  isStarPlayer?: boolean;
  category?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
}

export function PlayerPortraitAvatar({
  name,
  imageUrl,
  status = 'UPCOMING',
  isStarPlayer = false,
  category = 'M1',
  className = '',
  size = 'hero',
}: PlayerPortraitAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Extract initials for fallback silhouette safely
  const nameParts = (name || '').trim().split(/\s+/).filter(Boolean);
  const firstInitial = nameParts[0]?.[0] || 'P';
  const lastInitial = nameParts.length > 1 ? nameParts[nameParts.length - 1]?.[0] || '' : nameParts[0]?.[1] || 'A';
  const initials = `${firstInitial}${lastInitial}`.toUpperCase();

  // Validate image URL presence
  const cleanUrl = typeof imageUrl === 'string' ? imageUrl.trim() : null;
  const hasValidImageSource = Boolean(cleanUrl && cleanUrl.length > 0 && !imageError);

  // Is it a local asset (starts with '/' or 'data:')?
  const isLocalAsset = Boolean(cleanUrl && (cleanUrl.startsWith('/') || cleanUrl.startsWith('data:')));

  // Glow styling based on auction state
  const getGlowStyles = () => {
    switch (status) {
      case 'LIVE':
        return 'from-purple-600/30 via-fuchsia-500/20 to-amber-500/30 border-purple-500/60 shadow-[0_0_30px_rgba(168,85,247,0.35)]';
      case 'SOLD':
        return 'from-amber-500/40 via-yellow-500/30 to-purple-600/30 border-amber-400/80 shadow-[0_0_35px_rgba(245,158,11,0.4)]';
      case 'UNSOLD':
        return 'from-slate-700/20 via-zinc-800/20 to-slate-900/30 border-slate-700/40 shadow-none';
      case 'UPCOMING':
      default:
        return 'from-purple-900/20 via-blue-900/10 to-indigo-900/20 border-purple-500/30 shadow-[0_0_20px_rgba(139,92,246,0.15)]';
    }
  };

  return (
    <div className={`relative group flex-shrink-0 select-none pointer-events-none ${className}`}>
      {/* Background Ambient Glow Halo */}
      <motion.div
        animate={
          status === 'LIVE'
            ? { scale: [1, 1.05, 1], opacity: [0.6, 0.9, 0.6] }
            : status === 'SOLD'
            ? { scale: [1, 1.03, 1], opacity: [0.7, 0.95, 0.7] }
            : { scale: 1, opacity: 0.4 }
        }
        transition={{
          duration: status === 'LIVE' ? 3 : 5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className={`absolute -inset-2 rounded-2xl sm:rounded-3xl bg-gradient-to-tr ${getGlowStyles()} blur-xl opacity-75 pointer-events-none transition-all duration-700`}
      />

      {/* Main Avatar Container Box */}
      <div
        className={`relative aspect-square rounded-2xl sm:rounded-3xl overflow-hidden border-2 bg-gradient-to-b from-[#181F2A] via-[#0F141E] to-[#090D15] flex items-center justify-center shadow-2xl transition-all duration-500 ${
          status === 'LIVE'
            ? 'border-purple-400/70'
            : status === 'SOLD'
            ? 'border-amber-400/80'
            : status === 'UNSOLD'
            ? 'border-zinc-800 opacity-80'
            : 'border-purple-500/30'
        }`}
      >
        {/* Subtle Background Circuit Grid Mesh */}
        <div className="absolute inset-0 bg-[radial-gradient(#9333ea_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

        {hasValidImageSource ? (
          /* REAL PLAYER PORTRAIT IMAGE (LOCAL OR REMOTE SAFE RENDER) */
          <div className="relative w-full h-full overflow-hidden">
            {isLocalAsset ? (
              <Image
                src={cleanUrl!}
                alt={name}
                fill
                sizes="(max-width: 640px) 140px, (max-width: 1024px) 200px, 240px"
                className={`object-cover object-top transition-transform duration-700 group-hover:scale-105 ${
                  status === 'UNSOLD' ? 'grayscale opacity-60' : ''
                }`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
                priority
              />
            ) : (
              // Standard native img for external URLs to prevent Next.js domain whitelist exceptions
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cleanUrl!}
                alt={name}
                className={`w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105 ${
                  status === 'UNSOLD' ? 'grayscale opacity-60' : ''
                }`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
            )}

            {/* Bottom Glass Gradient Mask for Typography Contrast */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-transparent to-transparent opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-tr from-purple-900/10 via-transparent to-amber-500/10 mix-blend-overlay" />
          </div>
        ) : (
          /* NEUTRAL PROFESSIONAL DARK SILHOUETTE AVATAR */
          <div className="relative w-full h-full flex flex-col items-center justify-center p-4 text-center overflow-hidden">
            {/* Vector Head/Shoulders Silhouette Background */}
            <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
              <User className="w-28 h-28 sm:w-36 sm:h-36 text-purple-300 stroke-[1.2]" />
            </div>

            {/* Abstract Sports Energy Ring */}
            <div className="relative z-10 w-14 h-14 sm:w-18 sm:h-18 rounded-full bg-gradient-to-br from-purple-600/30 to-indigo-800/40 border border-purple-400/40 flex items-center justify-center shadow-lg backdrop-blur-md mb-2">
              <span className="font-mono text-lg sm:text-2xl font-black tracking-widest text-purple-200 drop-shadow">
                {initials}
              </span>
            </div>

            <span className="relative z-10 text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-purple-300/70 font-semibold px-2 py-0.5 rounded bg-purple-950/40 border border-purple-500/20 backdrop-blur-sm">
              PLAYER PROFILE
            </span>
          </div>
        )}

        {/* STAR / MARQUEE OVERLAY BADGE */}
        {isStarPlayer && status !== 'UNSOLD' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute top-2.5 right-2.5 z-20 bg-gradient-to-r from-amber-500 to-yellow-400 text-black px-2 py-0.5 rounded-full font-mono text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-lg border border-yellow-200"
          >
            <Sparkles className="w-3 h-3 fill-black text-black" />
            <span>STAR</span>
          </motion.div>
        )}

        {/* STATUS STAMP OVERLAY FOR SOLD & UNSOLD */}
        <AnimatePresence>
          {status === 'SOLD' && (
            <motion.div
              initial={{ scale: 2, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
            >
              <div className="border-4 border-amber-400 bg-amber-500/20 text-amber-300 font-mono text-2xl sm:text-3xl font-black tracking-widest px-4 py-1.5 rounded-xl uppercase transform shadow-[0_0_30px_rgba(245,158,11,0.5)] flex items-center gap-2">
                <Shield className="w-6 h-6 fill-amber-400 text-black" />
                <span>SOLD</span>
              </div>
            </motion.div>
          )}

          {status === 'UNSOLD' && (
            <motion.div
              initial={{ scale: 1.5, opacity: 0, rotate: 10 }}
              animate={{ scale: 1, opacity: 1, rotate: 6 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
            >
              <div className="border-2 border-slate-400 bg-slate-800/80 text-slate-300 font-mono text-xl sm:text-2xl font-black tracking-widest px-3 py-1 rounded-lg uppercase shadow-lg">
                UNSOLD
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
