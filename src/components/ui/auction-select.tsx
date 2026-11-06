'use client';

import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

interface AuctionSelectProps {
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}

/** A keyboard-accessible menu that uses the same palette as the auction. */
export function AuctionSelect({ id, label, value, onValueChange, options, className = '' }: AuctionSelectProps) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger id={id} aria-label={label} className={`flex h-12 min-w-0 items-center justify-between gap-3 rounded-lg border border-[#39443B] bg-[#0B0F0D] px-3 text-left text-sm font-semibold text-[#F3F4F1] transition-colors hover:border-[#C9A227]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] data-[state=open]:border-[#C9A227] [&>span:first-child]:truncate ${className}`}>
        <Select.Value />
        <Select.Icon><ChevronDown className="h-4 w-4 shrink-0 text-[#C9A227]" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={6} collisionPadding={12} className="z-[80] max-h-[min(320px,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-0 overflow-hidden rounded-xl border border-[#39443B] bg-[#141917] p-1.5 text-[#F3F4F1] shadow-2xl shadow-black/60">
          <Select.ScrollUpButton className="flex h-7 items-center justify-center text-[#C9A227]"><ChevronUp className="h-4 w-4" /></Select.ScrollUpButton>
          <Select.Viewport>
            {options.map(option => (
              <Select.Item key={option.value} value={option.value} className="relative flex min-h-11 cursor-pointer select-none items-center rounded-lg py-2 pl-3 pr-9 text-sm outline-none data-[highlighted]:bg-[#C9A227]/15 data-[highlighted]:text-[#E4B93F] data-[state=checked]:text-[#E4B93F]">
                <Select.ItemText><span className="break-words">{option.label}</span></Select.ItemText>
                <Select.ItemIndicator className="absolute right-3"><Check className="h-4 w-4" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="flex h-7 items-center justify-center text-[#C9A227]"><ChevronDown className="h-4 w-4" /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
