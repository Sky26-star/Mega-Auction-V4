'use client';

// src/components/rooms/room-invite-modal.tsx
// Mega Auction V4 Share Room Invite Modal (Matches Dark Sports Theme)

import React, { useState, useEffect } from 'react';
import { Share2, Copy, CheckCircle, X, Shield, Globe, Send, AlertCircle } from 'lucide-react';

export interface RoomInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomCode: string;
  roomName?: string;
}

export function RoomInviteModal({
  isOpen,
  onClose,
  roomCode,
  roomName = 'Mega Auction Room',
}: RoomInviteModalProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [sharedSuccess, setSharedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset transient feedback when opening
  useEffect(() => {
    if (isOpen) {
      setCopiedCode(false);
      setCopiedLink(false);
      setSharedSuccess(false);
      setErrorMessage(null);
    }
  }, [isOpen]);

  // Keyboard accessibility: Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Canonical invitation URL pointing to the actual room join checkpoint route
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const inviteUrl = origin && roomCode ? `${origin}/rooms/join?code=${roomCode.toUpperCase()}` : '';

  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false;
    // 1. Try modern Clipboard API
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('navigator.clipboard.writeText failed, using fallback:', err);
      }
    }

    // 2. Reliable textarea fallback
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
    if (!roomCode) {
      setErrorMessage('Room code is unavailable.');
      return;
    }
    setErrorMessage(null);
    const success = await copyToClipboard(roomCode.toUpperCase());
    if (success) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setErrorMessage('Could not access clipboard. Please copy the code manually.');
    }
  };

  const handleCopyLink = async () => {
    if (!inviteUrl) {
      setErrorMessage('Invitation link is unavailable.');
      return;
    }
    setErrorMessage(null);
    const success = await copyToClipboard(inviteUrl);
    if (success) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setErrorMessage('Could not access clipboard. Please copy the link manually.');
    }
  };

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    if (!inviteUrl) {
      setErrorMessage('Invitation link is unavailable.');
      return;
    }
    setErrorMessage(null);
    if (canNativeShare) {
      try {
        await navigator.share({
          title: roomName,
          text: `Join the live cricket auction in "${roomName}"! Use room code ${roomCode}.`,
          url: inviteUrl,
        });
        setSharedSuccess(true);
        setTimeout(() => setSharedSuccess(false), 2000);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Native share failed, falling back to copy:', err);
          await handleCopyLink();
        }
      }
    } else {
      await handleCopyLink();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans" role="dialog" aria-modal="true" aria-labelledby="share-room-invite-title">
      <div
        className="absolute inset-0 bg-[#0B0F0D]/90 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg bg-[#141917] rounded-3xl border-2 border-[#2A312D] shadow-2xl p-6 sm:p-7 space-y-6 z-10 animate-fade-in text-[#F3F4F1]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2A312D] pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-emerald-400 shadow-inner">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="share-room-invite-title" className="text-xl font-black uppercase font-display tracking-wider text-[#F3F4F1]">
                SHARE ROOM INVITE
              </h2>
              <p className="text-xs text-[#9CA6A0] truncate max-w-[260px] sm:max-w-xs">
                {roomName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close invite modal"
            className="p-2 rounded-lg text-[#9CA6A0] hover:text-[#F3F4F1] hover:bg-[#2A312D] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div role="alert" className="p-3.5 rounded-xl bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-center space-x-3 text-[#F3F4F1] text-xs">
            <AlertCircle className="w-4 h-4 text-[#B8322E] flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Room Code Card */}
        <div className="p-4 rounded-2xl bg-[#0B0F0D] border border-[#2A312D] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-widest flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#E4B93F]" />
              <span>ROOM LOBBY CODE</span>
            </span>
            <span className="text-[10px] font-mono-numbers font-extrabold text-[#E4B93F] bg-[#141917] px-2 py-0.5 rounded border border-[#2A312D]">
              6-CHARACTER CODE
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            {roomCode ? (
              <code className="text-2xl sm:text-3xl font-mono-numbers font-black text-[#E4B93F] tracking-widest selection:bg-[#C9A227]/30">
                {roomCode}
              </code>
            ) : (
              <span className="text-xs font-mono font-bold text-[#9CA6A0]">
                CODE UNAVAILABLE
              </span>
            )}

            <button
              type="button"
              onClick={handleCopyCode}
              disabled={!roomCode}
              className="px-4 py-2.5 rounded-xl bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] hover:border-[#C9A227]/50 text-xs font-mono-numbers font-bold flex items-center space-x-2 transition-all active:scale-95 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title="Copy Room Code"
            >
              {copiedCode ? (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 text-xs">COPIED ✓</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-[#C9A227]" />
                  <span className="text-[#E4B93F]">COPY CODE</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Canonical Direct Invite Link */}
        <div className="p-4 rounded-2xl bg-[#0B0F0D] border border-[#2A312D] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-widest flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span>DIRECT INVITATION LINK</span>
            </span>
            <span className="text-[10px] font-mono-numbers text-slate-400">
              One-Click Join
            </span>
          </div>

          <div className="relative">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              placeholder="No invite link available"
              onFocus={(e) => e.target.select()}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#141917] border border-[#2A312D] text-xs font-mono text-slate-300 focus:outline-none focus:ring-1 focus:ring-[#C9A227] select-all truncate disabled:opacity-40"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={!inviteUrl}
              className="w-full py-2.5 px-4 rounded-xl bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] hover:border-[#C9A227]/50 text-xs font-mono-numbers font-bold flex items-center justify-center space-x-2 transition-all active:scale-95 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {copiedLink ? (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">LINK COPIED ✓</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-[#C9A227]" />
                  <span className="text-[#F3F4F1]">COPY INVITE LINK</span>
                </>
              )}
            </button>

            {canNativeShare ? (
              <button
                type="button"
                onClick={handleNativeShare}
                disabled={!inviteUrl}
                className="w-full py-2.5 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] border border-[#7C3AED]/50 text-white text-xs font-mono-numbers font-bold flex items-center justify-center space-x-2 transition-all active:scale-95 shadow-md shadow-purple-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sharedSuccess ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-300" />
                    <span>SHARED ✓</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>SHARE VIA APPS...</span>
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center justify-center text-[11px] font-mono text-[#9CA6A0] px-3">
                Send this link to other managers
              </div>
            )}
          </div>
        </div>

        {/* Footer info note */}
        <p className="text-[11px] text-[#9CA6A0] text-center leading-relaxed">
          Invited managers can join instantly using this link or by entering the code on the{' '}
          <span className="text-[#E4B93F] font-bold">Join Room</span> page.
        </p>

        {/* Done / Close Button */}
        <div className="pt-2 border-t border-[#2A312D]">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] hover:border-[#C9A227]/40 text-xs font-bold uppercase tracking-wider transition-all"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
