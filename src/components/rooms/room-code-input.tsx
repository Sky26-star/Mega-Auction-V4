'use client';

// src/components/rooms/room-code-input.tsx
import React, { useRef } from 'react';

interface RoomCodeInputProps {
  code: string;
  onChange: (newCode: string) => void;
  isInvalid?: boolean;
  disabled?: boolean;
}

export function RoomCodeInput({
  code,
  onChange,
  isInvalid = false,
  disabled = false,
}: RoomCodeInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const codeChars = Array.from({ length: 6 }, (_, i) => code[i] || '');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const rawVal = e.target.value;
    // Take the last entered character if length > 1
    const char = rawVal.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);

    const newChars = [...codeChars];
    newChars[index] = char;
    const newCode = newChars.join('').slice(0, 6);
    onChange(newCode);

    // Auto-advance focus if character was entered
    if (char && index < 5 && inputsRef.current[index + 1]) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      if (!codeChars[index] && index > 0) {
        // Current box is empty, move back and clear previous
        const newChars = [...codeChars];
        newChars[index - 1] = '';
        const newCode = newChars.join('');
        onChange(newCode);
        inputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const cleaned = pastedText.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (cleaned) {
      onChange(cleaned);
      const nextFocusIndex = Math.min(cleaned.length, 5);
      inputsRef.current[nextFocusIndex]?.focus();
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        {Array.from({ length: 6 }).map((_, index) => {
          const char = codeChars[index] || '';
          const hasVal = Boolean(char);

          return (
            <input
              key={index}
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              type="text"
              inputMode="text"
              maxLength={1}
              value={char}
              onChange={(e) => handleInputChange(e, index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onPaste={handlePaste}
              disabled={disabled}
              aria-label={`Room code character ${index + 1} of 6`}
              className={`w-11 sm:w-14 h-14 sm:h-16 rounded-xl bg-[#0B0F0D] border-2 text-center text-xl sm:text-2xl font-black font-mono-numbers tracking-widest uppercase transition-all duration-200 focus:outline-none ${
                isInvalid
                  ? 'border-[#B8322E] text-[#B8322E] shadow-lg shadow-[#B8322E]/20 animate-shake'
                  : hasVal
                  ? 'border-[#C9A227] text-[#E4B93F] bg-[#181E1A] shadow-md shadow-[#C9A227]/20 scale-105'
                  : 'border-[#2A312D] text-[#F3F4F1] focus:border-[#C9A227] focus:bg-[#181E1A] focus:shadow-md focus:shadow-[#C9A227]/20'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            />
          );
        })}
      </div>
    </div>
  );
}
