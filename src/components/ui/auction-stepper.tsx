'use client';

// src/components/ui/auction-stepper.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';

interface AuctionStepperProps {
  label: string;
  subtext?: string;
  icon?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (val: number) => string;
  formatDelta: (delta: number) => string;
  onChange: (newValue: number) => void;
  id?: string;
}

export function AuctionStepper({
  label,
  subtext,
  icon,
  value,
  min,
  max,
  step,
  formatValue,
  formatDelta,
  onChange,
  id,
}: AuctionStepperProps) {
  const [deltaText, setDeltaText] = useState<string | null>(null);
  const prevValueRef = useRef<number>(value);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const canDecrease = value > min;
  const canIncrease = value < max;

  const handleStep = (direction: 'DEC' | 'INC') => {
    if (direction === 'DEC' && canDecrease) {
      const nextVal = Math.max(min, value - step);
      const diff = nextVal - value;
      triggerDelta(diff);
      onChange(nextVal);
    } else if (direction === 'INC' && canIncrease) {
      const nextVal = Math.min(max, value + step);
      const diff = nextVal - value;
      triggerDelta(diff);
      onChange(nextVal);
    }
  };

  const triggerDelta = (diff: number) => {
    if (diff === 0) return;
    const formatted = formatDelta(diff);
    setDeltaText(formatted);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDeltaText(null);
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <label htmlFor={id} className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
        </label>

        {/* Delta Animation Badge */}
        {deltaText && (
          <span className="text-[10px] font-mono-numbers font-black px-2 py-0.5 rounded bg-[#C9A227]/20 border border-[#C9A227]/60 text-[#E4B93F] animate-fade-in-out transition-all">
            {deltaText}
          </span>
        )}
      </div>

      {/* Stepper Control Container */}
      <div
        id={id}
        className="flex items-center justify-between p-1.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] shadow-inner focus-within:border-[#C9A227] focus-within:ring-1 focus-within:ring-[#C9A227] transition-all"
      >
        {/* Decrement (-) Button */}
        <button
          type="button"
          onClick={() => handleStep('DEC')}
          disabled={!canDecrease}
          aria-label={`Decrease ${label}`}
          className="w-10 h-10 rounded-lg bg-[#141917] hover:bg-[#181E1A] active:scale-95 border border-[#2A312D] hover:border-[#C9A227]/60 text-[#F3F4F1] hover:text-[#E4B93F] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[#141917] disabled:hover:border-[#2A312D] disabled:hover:text-[#F3F4F1] flex items-center justify-center transition-all shadow-sm"
        >
          <Minus className="w-4 h-4" />
        </button>

        {/* Value Display */}
        <div className="flex-1 text-center px-3 select-none">
          <span className="text-base sm:text-lg font-black font-mono-numbers text-[#E4B93F] tracking-wide">
            {formatValue(value)}
          </span>
        </div>

        {/* Increment (+) Button */}
        <button
          type="button"
          onClick={() => handleStep('INC')}
          disabled={!canIncrease}
          aria-label={`Increase ${label}`}
          className="w-10 h-10 rounded-lg bg-[#141917] hover:bg-[#181E1A] active:scale-95 border border-[#2A312D] hover:border-[#C9A227]/60 text-[#F3F4F1] hover:text-[#E4B93F] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[#141917] disabled:hover:border-[#2A312D] disabled:hover:text-[#F3F4F1] flex items-center justify-center transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
