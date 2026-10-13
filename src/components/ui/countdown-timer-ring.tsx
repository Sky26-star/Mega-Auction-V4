'use client';

// src/components/ui/countdown-timer-ring.tsx
// 10/10+ Refined Broadcast Countdown Timer Ring with Expired & Urgency Aura

import React from 'react';
import { motion } from 'framer-motion';

interface CountdownTimerRingProps {
  seconds: number;
  maxSeconds?: number;
  size?: number; // width/height in px for SVG
  strokeWidth?: number;
  className?: string;
}

export function CountdownTimerRing({
  seconds,
  maxSeconds = 15,
  size = 58,
  strokeWidth = 4,
  className = '',
}: CountdownTimerRingProps) {
  const safeSeconds = Math.max(0, seconds);
  const safeMax = Math.max(1, maxSeconds);
  const progress = Math.min(1, safeSeconds / safeMax);

  // SVG Geometry calculation
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  // Determine urgency level
  const isExpired = safeSeconds === 0;
  const isCritical = safeSeconds <= 3 && !isExpired;
  const isUrgent = safeSeconds <= 5 && !isCritical && !isExpired;

  const getUrgencyColor = () => {
    if (isExpired) return '#EF4444'; // Red-500 pulsing
    if (isCritical) return '#EF4444'; // Red-500
    if (isUrgent) return '#F59E0B'; // Amber-500
    return '#A855F7'; // Purple-500
  };

  const getUrgencyGlow = () => {
    if (isExpired) return 'drop-shadow-[0_0_12px_rgba(239,68,68,0.9)]';
    if (isCritical) return 'drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]';
    if (isUrgent) return 'drop-shadow-[0_0_6px_rgba(245,158,11,0.6)]';
    return 'drop-shadow-[0_0_5px_rgba(168,85,247,0.4)]';
  };

  return (
    <div
      className={`relative inline-flex items-center justify-center flex-shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-live="polite"
      aria-label={isExpired ? 'Timer expired' : `${safeSeconds} seconds remaining`}
    >
      {/* Background Outer Glow Ring */}
      <motion.div
        animate={
          isExpired
            ? { scale: [1, 1.15, 1], opacity: [0.8, 1, 0.8] }
            : isCritical
            ? { scale: [1, 1.1, 1], opacity: [0.7, 1, 0.7] }
            : isUrgent
            ? { scale: [1, 1.05, 1], opacity: [0.5, 0.8, 0.5] }
            : { scale: 1, opacity: 0.3 }
        }
        transition={{ duration: isExpired ? 0.4 : isCritical ? 0.6 : 1, repeat: Infinity }}
        className="absolute inset-0 rounded-full blur-sm pointer-events-none"
        style={{ backgroundColor: getUrgencyColor() }}
      />

      {/* SVG Circular Progress Ring */}
      <svg
        width={size}
        height={size}
        className="transform -rotate-90 relative z-10"
      >
        {/* Track Ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />

        {/* Animated Progress Ring */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={getUrgencyColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          strokeLinecap="round"
          fill="transparent"
          className={`transition-colors duration-300 ${getUrgencyGlow()}`}
        />
      </svg>

      {/* Center Countdown Value Display */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center">
        <motion.span
          key={safeSeconds}
          initial={{ scale: 1.2, opacity: 0.8 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.15 }}
          className={`font-mono text-sm sm:text-base font-black tracking-tighter leading-none ${
            isExpired
              ? 'text-red-400 font-extrabold animate-pulse'
              : isCritical
              ? 'text-red-400 font-extrabold'
              : isUrgent
              ? 'text-amber-300'
              : 'text-purple-200'
          }`}
        >
          {safeSeconds}
        </motion.span>
        <span
          className={`text-[7px] font-mono font-bold uppercase tracking-widest leading-none mt-0.5 ${
            isExpired ? 'text-red-300 font-black' : 'text-zinc-400'
          }`}
        >
          {isExpired ? 'TIME UP' : 'SEC'}
        </span>
      </div>
    </div>
  );
}
