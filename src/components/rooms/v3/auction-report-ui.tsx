import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Users } from 'lucide-react';
import { Navbar } from '@/components/layout/navbar';
import { formatLakhsToCr } from '@/lib/auction/units';

export function AuctionReportLayout({
  roomId,
  active,
  children,
}: {
  roomId: string;
  active: 'stats' | 'squad';
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] selection:bg-[#C9A227]/30">
      <Navbar auctionRoom />
      <main className="mx-auto w-full max-w-7xl space-y-7 px-4 pb-12 pt-5 sm:space-y-8 sm:px-6 sm:pt-7 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2A312D] pb-5">
          <Link
            href={`/rooms/${roomId}/auction`}
            className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[#9CA6A0] transition-colors hover:text-[#E4B93F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to auction
          </Link>
          <nav
            aria-label="Auction reports"
            className="grid grid-cols-2 gap-1 rounded-xl border border-[#2A312D] bg-[#141917] p-1"
          >
            {(
              [
                { id: 'squad', label: 'Squads', icon: Users },
                { id: 'stats', label: 'Stats', icon: BarChart3 },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <Link
                key={id}
                href={`/rooms/${roomId}/${id}`}
                aria-current={active === id ? 'page' : undefined}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${active === id ? 'bg-[#C9A227] text-[#0B0F0D]' : 'text-[#9CA6A0] hover:bg-[#1E2522] hover:text-[#F3F4F1]'}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {children}
      </main>
    </div>
  );
}

export function ReportTitle({
  eyebrow,
  title,
  accent,
  description,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">
        <span className="h-px w-5 bg-[#C9A227]" />
        {eyebrow}
      </p>
      <h1 className="text-3xl font-bold uppercase leading-[1.12] tracking-tight sm:text-4xl lg:text-5xl">
        {title} <span className="text-[#E4B93F]">{accent}</span>
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#9CA6A0]">{description}</p>
    </div>
  );
}

export function SectionHeading({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold uppercase tracking-wide">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-[#9CA6A0]">{subtitle}</p>}
      </div>
      {aside && <span className="text-xs text-[#9CA6A0]">{aside}</span>}
    </div>
  );
}

export function MoneyAmount({
  lakhs,
  className = '',
}: {
  lakhs: number | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-baseline gap-x-1 font-mono-numbers tabular-nums ${className}`}
    >
      <span className="break-all">₹{formatLakhsToCr(lakhs)}</span>
      <span className="text-[0.55em] font-medium text-[#9CA6A0]">Cr</span>
    </span>
  );
}

export function ReportMetric({
  label,
  children,
  detail,
  highlight = false,
}: {
  label: string;
  children: ReactNode;
  detail?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${highlight ? 'border-[#C9A227]/40 bg-[#191F18]' : 'border-[#2A312D] bg-[#141917]'}`}
    >
      <p className="mb-3 text-[10px] font-semibold uppercase leading-relaxed tracking-[0.12em] text-[#9CA6A0]">
        {label}
      </p>
      <div
        className={`text-[clamp(1.25rem,3vw,1.75rem)] font-semibold leading-tight tabular-nums ${highlight ? 'text-[#E4B93F]' : 'text-[#F3F4F1]'}`}
      >
        {children}
      </div>
      {detail && <p className="mt-2 text-xs text-[#9CA6A0]">{detail}</p>}
    </div>
  );
}

export function ReportFeedback({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-2xl border border-[#2A312D] bg-[#141917] p-8 text-center"
      role={error ? 'alert' : 'status'}
    >
      {loading ? (
        <>
          <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-[#C9A227] border-t-transparent" />
          <p className="text-sm text-[#9CA6A0]">Loading auction data…</p>
        </>
      ) : (
        <>
          <p className="text-sm text-[#9CA6A0]">{error || 'No auction data is available yet.'}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-4 min-h-11 rounded-lg border border-[#C9A227]/40 px-5 text-sm font-semibold text-[#E4B93F] hover:bg-[#C9A227]/10"
            >
              Try again
            </button>
          )}
        </>
      )}
    </div>
  );
}
