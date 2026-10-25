'use client';

// src/components/rooms/auction-invite-panel.tsx
import React, { useState } from 'react';
import { Copy, CheckCircle, Share2, AlertCircle } from 'lucide-react';

export interface AuctionInvitePanelProps {
  roomCode: string;
}

export function AuctionInvitePanel({ roomCode }: AuctionInvitePanelProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('navigator.clipboard.writeText failed, using fallback:', err);
      }
    }

    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.error('Fallback clipboard copy failed:', err);
      return false;
    }
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    setError(null);
    const success = await copyToClipboard(roomCode.toUpperCase());
    if (success) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setError('Clipboard copy failed. Please copy manually.');
    }
  };

  const handleCopyLink = async () => {
    if (typeof window === 'undefined' || !roomCode) return;
    setError(null);
    const inviteUrl = `${window.location.origin}/rooms/join?code=${roomCode.toUpperCase()}`;
    const success = await copyToClipboard(inviteUrl);
    if (success) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setError('Clipboard copy failed. Please copy manually.');
    }
  };

  return (
    <div className="w-full rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-4 shadow-xl space-y-3 font-sans">
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

      {error && (
        <div role="alert" className="p-2 rounded-lg bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-center space-x-2 text-[#F3F4F1] text-[11px]">
          <AlertCircle className="w-3.5 h-3.5 text-[#B8322E] flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Room Code Display Box */}
      <div className="p-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-between">
        <div>
          <span className="block text-[9px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-widest mb-0.5">
            ROOM LOBBY CODE
          </span>
          {roomCode ? (
            <code className="text-xl font-mono-numbers font-black text-[#E4B93F] tracking-widest">
              {roomCode}
            </code>
          ) : (
            <span className="text-xs font-mono font-bold text-[#9CA6A0]">
              UNAVAILABLE
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopyCode}
          disabled={!roomCode}
          className="px-3 py-1.5 rounded-lg bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#E4B93F] text-xs font-mono-numbers font-bold flex items-center space-x-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
        disabled={!roomCode}
        className="w-full py-2 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] hover:border-[#C9A227]/40 text-xs font-mono-numbers font-bold flex items-center justify-center space-x-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
