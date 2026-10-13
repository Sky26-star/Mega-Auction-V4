'use client';

// src/components/rooms/auction-invite-panel.tsx
import React, { useState } from 'react';
import { Copy, CheckCircle, Share2 } from 'lucide-react';

export interface AuctionInvitePanelProps {
  roomCode: string;
}

export function AuctionInvitePanel({ roomCode }: AuctionInvitePanelProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    if (typeof window === 'undefined') return;
    const inviteUrl = `${window.location.origin}/rooms/join?code=${roomCode}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-4 shadow-xl space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#2A312D] pb-2.5">
        <h3 className="text-xs font-black text-[#F3F4F1] uppercase font-display tracking-wider flex items-center gap-2">
          <Share2 className="w-4 h-4 text-[#E4B93F]" />
          <span>INVITE MANAGERS</span>
        </h3>

        <span className="text-[10px] font-mono-numbers font-extrabold text-[#C9A227] bg-[#0B0F0D] px-2 py-0.5 rounded border border-[#2A312D]">
          JOIN CODE
        </span>
      </div>

      {/* Room Code Display Box */}
      <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-between">
        <div>
          <span className="block text-[9px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-widest mb-0.5">
            ROOM LOBBY CODE
          </span>
          <code className="text-xl font-mono-numbers font-black text-[#E4B93F] tracking-widest">
            {roomCode}
          </code>
        </div>

        <button
          type="button"
          onClick={handleCopyCode}
          className="px-3 py-1.5 rounded-lg bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#E4B93F] text-xs font-mono-numbers font-bold flex items-center space-x-1.5 transition-colors"
          title="Copy Room Code"
        >
          {copiedCode ? (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 text-[11px]">COPIED ✓</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>COPY CODE</span>
            </>
          )}
        </button>
      </div>

      {/* Direct Invite Link Copy Action */}
      <button
        type="button"
        onClick={handleCopyLink}
        className="w-full py-2 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] hover:border-[#C9A227]/40 text-xs font-mono-numbers font-bold flex items-center justify-center space-x-2 transition-all"
      >
        {copiedLink ? (
          <>
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-400 text-[11px]">INVITE LINK COPIED ✓</span>
          </>
        ) : (
          <>
            <Share2 className="w-3.5 h-3.5 text-[#C9A227]" />
            <span>COPY DIRECT INVITE LINK</span>
          </>
        )}
      </button>

    </div>
  );
}
