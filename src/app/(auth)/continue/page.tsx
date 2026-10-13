'use client';

import React, { useState, useCallback } from 'react';
import { useSignUp } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { AuctionGavelHero } from '@/components/auth/auction-gavel-hero';
import { LiveAuctionPreview } from '@/components/auth/live-auction-preview';
import { LiveActivityCounters } from '@/components/auth/live-activity-counters';
import { AuctionFeatureStrip } from '@/components/auth/auction-feature-strip';
import { Navbar } from '@/components/layout/navbar';

function ContinuationForm() {
  const { signUp } = useSignUp();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!signUp) return null;

  const missingFields = signUp.missingFields || [];
  const unverifiedFields = signUp.unverifiedFields || [];

  const needsFirstName = missingFields.includes('first_name' as any);
  const needsLastName = missingFields.includes('last_name' as any);
  const needsUsername = missingFields.includes('username' as any);
  const needsLegalAcceptance = missingFields.includes('legal_accepted' as any);
  
  const hasUnsupportedVerification = unverifiedFields.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg('');
    setIsSubmitting(true);

    try {
      const updateData: any = {};
      if (needsFirstName) updateData.firstName = firstName;
      if (needsLastName) updateData.lastName = lastName;
      if (needsUsername) updateData.username = username;
      if (needsLegalAcceptance) updateData.legalAccepted = legalAccepted;

      await signUp.update(updateData);

      if (signUp.status === 'complete') {
        await signUp.finalize({
          navigate: async ({ session, decorateUrl }: any) => {
            if (session?.currentTask) {
              console.log('Clerk session task requires completion:', session.currentTask);
              return;
            }

            const url = decorateUrl('/');
            if (url.startsWith('http')) {
              window.location.href = url;
            } else {
              router.push(url);
            }
          }
        });
      }
    } catch (err: any) {
      setErrorMsg(err.errors?.[0]?.longMessage || 'An error occurred during update.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md p-7 sm:p-9 rounded-2xl bg-[#141917] border border-[#2A312D] shadow-2xl shadow-black/90 backdrop-blur-xl transition-all relative z-10">
      <div className="text-center mb-6">
         <h2 className="text-[#F3F4F1] font-black text-sm sm:text-base uppercase tracking-[0.15em] drop-shadow-md">
           Complete Profile
         </h2>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center font-bold tracking-wide">
          {errorMsg}
        </div>
      )}

      {hasUnsupportedVerification ? (
        <div className="mb-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs text-center font-bold tracking-wide">
          This account requires verification for: {unverifiedFields.join(', ')}. 
          The current unified auth flow does not yet support verifying these identifiers during OAuth continuation.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
          {needsFirstName && (
            <div className="flex flex-col space-y-2">
              <label htmlFor="first_name" className="text-[#9CA6A0] text-[10px] font-bold uppercase tracking-widest px-1">
                First Name
              </label>
              <input
                id="first_name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter first name"
                className="w-full bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#4A544F] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] transition-all"
                required
              />
            </div>
          )}

          {needsLastName && (
            <div className="flex flex-col space-y-2">
              <label htmlFor="last_name" className="text-[#9CA6A0] text-[10px] font-bold uppercase tracking-widest px-1">
                Last Name
              </label>
              <input
                id="last_name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter last name"
                className="w-full bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#4A544F] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] transition-all"
                required
              />
            </div>
          )}

          {needsUsername && (
            <div className="flex flex-col space-y-2">
              <label htmlFor="username" className="text-[#9CA6A0] text-[10px] font-bold uppercase tracking-widest px-1">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                className="w-full bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#4A544F] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] transition-all"
                required
              />
            </div>
          )}

          {needsLegalAcceptance && (
            <div className="flex items-center space-x-3 py-2 px-1">
              <input
                id="legal_accepted"
                type="checkbox"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
                className="w-4 h-4 bg-[#0B0F0D] border border-[#2A312D] text-[#E4B93F] focus:ring-[#C9A227] rounded cursor-pointer"
                required
              />
              <label htmlFor="legal_accepted" className="text-[#9CA6A0] text-[10px] font-bold uppercase tracking-widest cursor-pointer">
                I accept the terms and conditions
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 px-5 rounded-xl bg-[#E4B93F] hover:bg-[#C9A227] text-[#0B0F0D] font-black text-[11px] sm:text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(228,185,63,0.2)] hover:shadow-[0_0_25px_rgba(228,185,63,0.4)] transition-all min-h-[52px] mt-2 disabled:opacity-50"
          >
            {isSubmitting ? 'Processing...' : 'Continue'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ContinuePage() {
  const [closingStrikeTrigger, setClosingStrikeTrigger] = useState(false);

  const handleClosingStrike = useCallback(() => {
    setClosingStrikeTrigger(true);
    const timer = setTimeout(() => {
      setClosingStrikeTrigger(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col relative overflow-x-hidden selection:bg-[#C9A227]/30 selection:text-[#E4B93F]">
      <Navbar />

      <div className="pointer-events-none absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-40">
        <div className="absolute -top-40 -left-40 w-[700px] h-[700px] bg-[#C9A227]/10 rounded-full blur-[180px]" />
        <div className="absolute top-1/2 -right-40 w-[600px] h-[600px] bg-[#B8322E]/10 rounded-full blur-[180px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#2A312D_1px,transparent_1px)] [background-size:32px_32px] opacity-25" />
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 flex items-center justify-center relative z-10 my-auto">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <div className="lg:col-span-7 flex flex-col space-y-4 py-1">
            <div className="order-1">
              <AuctionGavelHero closingStrikeTrigger={closingStrikeTrigger} />
            </div>
            <div className="order-2">
              <LiveAuctionPreview onClosingStrike={handleClosingStrike} />
            </div>
            <div className="order-4 lg:order-3">
              <LiveActivityCounters />
            </div>
            <div className="order-5 lg:order-4">
              <AuctionFeatureStrip />
            </div>
          </div>
          <div className="lg:col-span-5 flex justify-center lg:justify-end w-full order-3 lg:order-2 py-2">
            <ContinuationForm />
          </div>
        </div>
      </main>

      <footer className="py-3.5 border-t border-[#2A312D]/60 text-center relative z-10 mt-auto">
        <p className="text-[11px] font-mono-numbers text-[#9CA6A0] tracking-wider uppercase">
          MEGA AUCTION ARENA &bull; OFFICIAL CRICKET BROADCAST INTERFACE
        </p>
      </footer>
    </div>
  );
}
