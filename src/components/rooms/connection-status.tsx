'use client';

// src/components/rooms/connection-status.tsx
import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export interface ConnectionStatusProps {
  isConnected?: boolean;
  isReconnecting?: boolean;
  className?: string;
}

export function ConnectionStatus({
  isConnected = true,
  isReconnecting = false,
  className = '',
}: ConnectionStatusProps) {
  if (isReconnecting) {
    return (
      <div
        className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#E4B93F]/10 border border-[#E4B93F]/40 text-[#E4B93F] text-[11px] font-mono-numbers font-bold uppercase tracking-wider ${className}`}
      >
        <span className="w-2 h-2 rounded-full bg-[#E4B93F] animate-ping" />
        <Wifi className="w-3 h-3 text-[#E4B93F]" />
        <span>RECONNECTING</span>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div
        className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#B8322E]/10 border border-[#B8322E]/40 text-[#B8322E] text-[11px] font-mono-numbers font-bold uppercase tracking-wider ${className}`}
      >
        <span className="w-2 h-2 rounded-full bg-[#B8322E]" />
        <WifiOff className="w-3 h-3 text-[#B8322E]" />
        <span>OFFLINE</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono-numbers font-bold uppercase tracking-wider ${className}`}
    >
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-live" />
      <Wifi className="w-3 h-3 text-emerald-400" />
      <span>CONNECTED</span>
    </div>
  );
}
