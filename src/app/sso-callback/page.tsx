'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export default function SSOCallback() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex items-center justify-center">
      <div className="animate-pulse text-[#C9A227] tracking-widest uppercase font-bold text-sm">
        Authenticating...
      </div>
      <div id="clerk-captcha" />
      <AuthenticateWithRedirectCallback 
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
        continueSignUpUrl="/continue"
      />
    </div>
  );
}
