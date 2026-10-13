'use client';

// src/app/global-error.tsx
import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 text-center font-sans antialiased">
        <div className="max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <h2 className="text-xl font-bold text-red-400">Application Error</h2>
          <p className="text-xs text-slate-400">
            {error.message || 'A critical application error occurred.'}
          </p>
          <button
            onClick={() => reset()}
            className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-all"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
