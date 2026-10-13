'use client';

import React, { useEffect, useState } from 'react';
import { useAuth, useClerk, useSignIn } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

export function AuthForm() {
  const clerk = useClerk();
  const router = useRouter();

  const { signIn } = useSignIn();
  const { isLoaded, isSignedIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [isPhoneMode, setIsPhoneMode] = useState(false);

  const [pendingVerification, setPendingVerification] = useState<{
    type: 'signin' | 'signup';
    strategy: 'email_code' | 'phone_code';
  } | null>(null);

  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // ------------------------------------------------------------
  // Already authenticated → go directly to dashboard
  // ------------------------------------------------------------

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace('/dashboard');
    }
  }, [isLoaded, isSignedIn, router]);

  // ------------------------------------------------------------
  // OAuth
  // ------------------------------------------------------------

  const handleOAuth = async (
    strategy: 'oauth_google' | 'oauth_github' | 'oauth_apple'
  ) => {
    // Clerk is still loading.
    if (!isLoaded) return;

    // User already has an active Clerk session.
    // Never start another OAuth flow.
    if (isSignedIn) {
      router.replace('/dashboard');
      return;
    }

    if (!signIn) return;

    try {
      setErrorMsg('');

      await clerk.client.signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/dashboard',
      });
    } catch (err: any) {
      console.error(
        '[OAUTH] Clerk error:',
        JSON.stringify(err, null, 2)
      );

      setErrorMsg(
        err.errors?.[0]?.longMessage ||
        'An error occurred during OAuth initiation.'
      );
    }
  };

  // ------------------------------------------------------------
  // Email / Phone Continue
  // ------------------------------------------------------------

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();

    // Safety check.
    if (!isLoaded) return;

    // If session became active while the user was on this screen,
    // go to dashboard instead of starting another sign-in flow.
    if (isSignedIn) {
      router.replace('/dashboard');
      return;
    }

    setErrorMsg('');

    try {
      // ----------------------------------------------------------
      // Try existing user sign-in first
      // ----------------------------------------------------------

      const signInAttempt = await clerk.client.signIn.create({
        identifier,
      });

      const firstFactor = signInAttempt.supportedFirstFactors?.find(
        (f) =>
          f.strategy === 'email_code' ||
          f.strategy === 'phone_code'
      );

      if (firstFactor) {
        await clerk.client.signIn.prepareFirstFactor({
          strategy: firstFactor.strategy as any,
          emailAddressId: (firstFactor as any).emailAddressId,
          phoneNumberId: (firstFactor as any).phoneNumberId,
        });

        setPendingVerification({
          type: 'signin',
          strategy: firstFactor.strategy as
            | 'email_code'
            | 'phone_code',
        });
      } else {
        setErrorMsg('No supported first factor found.');
      }
    } catch (err: any) {
      // ----------------------------------------------------------
      // User does not exist → start account creation
      // ----------------------------------------------------------

      if (
        err.errors?.[0]?.code ===
        'form_identifier_not_found'
      ) {
        try {
          await clerk.client.signUp.create({
            emailAddress: isPhoneMode
              ? undefined
              : identifier,
            phoneNumber: isPhoneMode
              ? identifier
              : undefined,
          });

          if (isPhoneMode) {
            await clerk.client.signUp.preparePhoneNumberVerification({
              strategy: 'phone_code',
            });

            setPendingVerification({
              type: 'signup',
              strategy: 'phone_code',
            });
          } else {
            await clerk.client.signUp.prepareEmailAddressVerification({
              strategy: 'email_code',
            });

            setPendingVerification({
              type: 'signup',
              strategy: 'email_code',
            });
          }
        } catch (signUpError: any) {
          setErrorMsg(
            signUpError.errors?.[0]?.longMessage ||
            'An error occurred during account setup.'
          );
        }
      } else {
        setErrorMsg(
          err.errors?.[0]?.longMessage ||
          'An error occurred.'
        );
      }
    }
  };

  // ------------------------------------------------------------
  // Verification
  // ------------------------------------------------------------

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pendingVerification) return;

    setErrorMsg('');

    try {
      // ----------------------------------------------------------
      // Existing user verification
      // ----------------------------------------------------------

      if (pendingVerification.type === 'signin') {
        const verifyRes =
          await clerk.client.signIn.attemptFirstFactor({
            strategy: pendingVerification.strategy,
            code,
          });

        if (verifyRes.status === 'complete') {
          await clerk.setActive({
            session: verifyRes.createdSessionId,
          });

          // Full navigation ensures the new Clerk session is
          // recognized by the server before dashboard loads.
          window.location.href = '/dashboard';
        } else {
          setErrorMsg('Verification incomplete.');
        }

        return;
      }

      // ----------------------------------------------------------
      // New user verification
      // ----------------------------------------------------------

      const verifyRes =
        pendingVerification.strategy === 'email_code'
          ? await clerk.client.signUp.attemptEmailAddressVerification({
            code,
          })
          : await clerk.client.signUp.attemptPhoneNumberVerification({
            code,
          });

      if (verifyRes.status === 'complete') {
        await clerk.setActive({
          session: verifyRes.createdSessionId,
        });

        // Full navigation ensures the new Clerk session is
        // recognized by the server before dashboard loads.
        window.location.href = '/dashboard';
      } else {
        setErrorMsg('Verification incomplete.');
      }
    } catch (err: any) {
      setErrorMsg(
        err.errors?.[0]?.longMessage ||
        'Invalid code.'
      );
    }
  };

  // ------------------------------------------------------------
  // Reset verification
  // ------------------------------------------------------------

  const resetForm = () => {
    setPendingVerification(null);
    setCode('');
    setErrorMsg('');
  };

  // ------------------------------------------------------------
  // Do not render authentication UI while Clerk is loading
  // or when an authenticated user is being redirected.
  // ------------------------------------------------------------

  if (!isLoaded || isSignedIn) {
    return (
      <div className="w-full max-w-md p-7 sm:p-9 rounded-2xl bg-[#141917] border border-[#2A312D] shadow-2xl shadow-black/90 backdrop-blur-xl relative z-10 flex items-center justify-center min-h-[260px]">
        <div className="text-center">
          <div className="text-[#E4B93F] text-sm font-black uppercase tracking-[0.18em] animate-pulse">
            Entering Auction Arena...
          </div>

          <div className="mt-3 text-[#68716B] text-[10px] font-bold uppercase tracking-widest">
            Please wait
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  return (
    <div className="w-full max-w-md p-7 sm:p-9 rounded-2xl bg-[#141917] border border-[#2A312D] shadow-2xl shadow-black/90 backdrop-blur-xl transition-all relative z-10">

      {/* Heading */}
      <div className="text-center mb-6">
        <h2 className="text-[#F3F4F1] font-black text-sm sm:text-base uppercase tracking-[0.15em] drop-shadow-md">
          Welcome to Mega Auction Arena
        </h2>
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center font-bold tracking-wide">
          {errorMsg}
        </div>
      )}

      {!pendingVerification ? (
        <>
          {/* OAuth Buttons */}
          <div className="flex flex-col space-y-3">

            {/* Google */}
            <button
              type="button"
              onClick={() => handleOAuth('oauth_google')}
              className="w-full py-3.5 px-5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] font-bold text-[11px] sm:text-xs uppercase tracking-widest shadow-xl border border-[#2A312D] transition-all min-h-[52px] flex items-center justify-center space-x-3"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>

              <span className="text-[#F3F4F1] font-bold text-[11px] sm:text-xs uppercase tracking-widest ml-3">
                Continue with Google
              </span>
            </button>

            {/* GitHub */}
            <button
              type="button"
              onClick={() => handleOAuth('oauth_github')}
              className="w-full py-3.5 px-5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] font-bold text-[11px] sm:text-xs uppercase tracking-widest shadow-xl border border-[#2A312D] transition-all min-h-[52px] flex items-center justify-center space-x-3"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>

              <span className="text-[#F3F4F1] font-bold text-[11px] sm:text-xs uppercase tracking-widest ml-3">
                Continue with GitHub
              </span>
            </button>

            {/* Apple */}
            <button
              type="button"
              onClick={() => handleOAuth('oauth_apple')}
              className="w-full py-3.5 px-5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] font-bold text-[11px] sm:text-xs uppercase tracking-widest shadow-xl border border-[#2A312D] transition-all min-h-[52px] flex items-center justify-center space-x-3"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.62-1.496 3.604-2.998 1.14-1.674 1.606-3.297 1.632-3.376-.04-.013-3.17-1.214-3.21-4.856-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2.039-.181-3.921 1.103-4.478 1.103M15.549 4.316c.843-1.013 1.416-2.427 1.26-3.83-1.214.053-2.695.812-3.565 1.831-.785.91-1.46 2.35-.195 3.738 1.357.065 2.766-.753 3.5-1.739" />
              </svg>

              <span className="text-[#F3F4F1] font-bold text-[11px] sm:text-xs uppercase tracking-widest ml-3">
                Continue with Apple
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center my-6 space-x-3">
            <div className="flex-1 h-px bg-[#2A312D]" />

            <span className="text-[#9CA6A0] text-[10px] font-bold uppercase tracking-widest">
              OR
            </span>

            <div className="flex-1 h-px bg-[#2A312D]" />
          </div>

          {/* Email / Phone */}
          <form
            onSubmit={handleContinue}
            className="flex flex-col space-y-4"
          >
            <div className="flex flex-col space-y-2">

              <div className="flex justify-between items-center px-1">
                <label
                  htmlFor="identifier"
                  className="text-[#9CA6A0] text-[10px] font-bold uppercase tracking-widest"
                >
                  {isPhoneMode
                    ? 'Phone number'
                    : 'Email address'}
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setIsPhoneMode(!isPhoneMode);
                    setIdentifier('');
                    setErrorMsg('');
                  }}
                  className="text-[#E4B93F] hover:text-[#C9A227] text-[10px] font-bold uppercase tracking-widest transition-colors"
                >
                  {isPhoneMode
                    ? 'Use email'
                    : 'Use phone'}
                </button>
              </div>

              <input
                id="identifier"
                type={isPhoneMode ? 'tel' : 'email'}
                value={identifier}
                onChange={(e) =>
                  setIdentifier(e.target.value)
                }
                placeholder={
                  isPhoneMode
                    ? '+1 (555) 000-0000'
                    : 'Enter your email address'
                }
                className="w-full bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#4A544F] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] transition-all"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 px-5 rounded-xl bg-[#E4B93F] hover:bg-[#C9A227] text-[#0B0F0D] font-black text-[11px] sm:text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(228,185,63,0.2)] hover:shadow-[0_0_25px_rgba(228,185,63,0.4)] transition-all min-h-[52px] mt-2"
            >
              Continue
            </button>
          </form>
        </>
      ) : (
        /* Verification */
        <form
          onSubmit={handleVerify}
          className="flex flex-col space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <div className="flex flex-col space-y-2">

            <label
              htmlFor="code"
              className="text-[#9CA6A0] text-[10px] font-bold uppercase tracking-widest px-1"
            >
              Verification Code
            </label>

            <p className="text-[#9CA6A0] text-xs px-1 mb-2">
              We sent a code to{' '}
              <span className="text-[#F3F4F1] font-semibold">
                {identifier}
              </span>
            </p>

            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value)
              }
              placeholder="Enter code"
              className="w-full bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#4A544F] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] transition-all text-center tracking-[0.3em] font-mono"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 px-5 rounded-xl bg-[#E4B93F] hover:bg-[#C9A227] text-[#0B0F0D] font-black text-[11px] sm:text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(228,185,63,0.2)] hover:shadow-[0_0_25px_rgba(228,185,63,0.4)] transition-all min-h-[52px] mt-2"
          >
            Verify & Continue
          </button>

          <button
            type="button"
            onClick={resetForm}
            className="w-full py-3 px-5 rounded-xl text-[#9CA6A0] hover:text-[#F3F4F1] font-bold text-[10px] uppercase tracking-widest transition-colors mt-2"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
}