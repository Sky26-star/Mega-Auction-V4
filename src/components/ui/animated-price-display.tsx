'use client';

// src/components/ui/animated-price-display.tsx
// 10/10+ Broadcast Animated Price Counter with Interpolated Value Reveal

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AnimatedPriceDisplayProps {
  amountCr?: number | null;
  label?: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  accentColor?: 'gold' | 'purple' | 'green' | 'zinc';
  className?: string;
}

export function AnimatedPriceDisplay({
  amountCr = 0,
  label = 'CURRENT BID',
  size = 'hero',
  accentColor = 'gold',
  className = '',
}: AnimatedPriceDisplayProps) {
  const safeAmount = amountCr || 0;
  const formattedPrice = `₹${safeAmount.toFixed(2)} Cr`;
  const prevAmountRef = useRef<number>(safeAmount);
  const [hasChanged, setHasChanged] = useState(false);

  useEffect(() => {
    if (prevAmountRef.current !== safeAmount) {
      setHasChanged(true);
      const timer = setTimeout(() => setHasChanged(false), 900);
      prevAmountRef.current = safeAmount;
      return () => clearTimeout(timer);
    }
  }, [safeAmount]);

  const getColorClasses = () => {
    switch (accentColor) {
      case 'gold':
        return {
          text: 'text-amber-300 font-extrabold',
          glow: 'shadow-[0_0_20px_rgba(245,158,11,0.25)]',
          badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
        };
      case 'purple':
        return {
          text: 'text-purple-300 font-extrabold',
          glow: 'shadow-[0_0_20px_rgba(168,85,247,0.25)]',
          badge: 'text-purple-300 bg-purple-500/10 border-purple-500/30',
        };
      case 'green':
        return {
          text: 'text-emerald-300 font-extrabold',
          glow: 'shadow-[0_0_20px_rgba(16,185,129,0.25)]',
          badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
        };
      case 'zinc':
      default:
        return {
          text: 'text-zinc-200 font-extrabold',
          glow: 'shadow-none',
          badge: 'text-zinc-400 bg-zinc-800/50 border-zinc-700/50',
        };
    }
  };

  const colors = getColorClasses();

  const getSizeClasses = () => {
    switch (size) {
      case 'hero':
        return 'text-2xl sm:text-3xl md:text-4xl';
      case 'lg':
        return 'text-xl sm:text-2xl md:text-3xl';
      case 'md':
        return 'text-lg sm:text-xl';
      case 'sm':
      default:
        return 'text-base sm:text-lg';
    }
  };

  return (
    <div className={`relative flex flex-col ${className}`}>
      {label && (
        <span className="text-[9px] sm:text-[10px] font-mono font-bold tracking-widest uppercase text-zinc-400 mb-0.5 flex items-center gap-1.5">
          <span>{label}</span>
          {hasChanged && (
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[8px] font-mono font-extrabold px-1.5 py-0.2 rounded bg-amber-400 text-black uppercase tracking-wider animate-pulse"
            >
              UPDATED
            </motion.span>
          )}
        </span>
      )}

      {/* Main Animated Number Display */}
      <div className="relative inline-flex items-baseline font-mono overflow-hidden py-0.5">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={formattedPrice}
            initial={{ y: 14, opacity: 0, filter: 'blur(4px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: -14, opacity: 0, filter: 'blur(4px)' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={`font-black tracking-tight ${getSizeClasses()} ${colors.text} drop-shadow-md`}
          >
            {formattedPrice}
          </motion.span>
        </AnimatePresence>

        {/* Dynamic Glow Aura on Value Bump */}
        {hasChanged && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1.2 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-amber-400/20 blur-md pointer-events-none rounded-lg"
          />
        )}
      </div>
    </div>
  );
}
