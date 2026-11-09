'use client';

import Link from 'next/link';
import type { PlayerSet } from '@/lib/types/player-set';
import { Database, Users, Globe, Lock, ArrowRight, Edit, Trash2, Calendar } from 'lucide-react';

interface PlayerSetCardProps {
  playerSet: PlayerSet;
  isOwner: boolean;
  onEdit?: (playerSet: PlayerSet) => void;
  onDelete?: (playerSet: PlayerSet) => void;
}

export function PlayerSetCard({ playerSet, isOwner, onEdit, onDelete }: PlayerSetCardProps) {
  const formattedDate = new Date(playerSet.updated_at || playerSet.created_at).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'});
  const totalPlayers = playerSet.player_count || 0;
  const counts = playerSet.category_counts || {MARQUEE:0,A:0,B:0,C:0,D:0};
  const tiers = [
    {label:'Icon',count:counts.MARQUEE,color:'#E4B93F'},
    {label:'Elite',count:counts.A,color:'#C4A1ED'},
    {label:'Premier',count:counts.B,color:'#9DAFDD'},
    {label:'Core',count:counts.C,color:'#70BFA0'},
    {label:'Rising',count:counts.D,color:'#9CA6A0'},
  ];

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#2A312D] bg-[#141917] transition-colors hover:border-[#C9A227]/60">
      <div className="flex-1 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#E4B93F]"><Database className="h-5 w-5" /></div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-[#39443B] bg-[#0B0F0D] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#BBC3BD]">{playerSet.is_public ? <Globe className="h-3 w-3 text-[#70BFA0]" /> : <Lock className="h-3 w-3" />}{playerSet.is_public ? 'Public pool' : 'Private pool'}</span>
        </div>
        <h2 className="break-words text-xl font-semibold leading-snug transition-colors group-hover:text-[#E4B93F]">{playerSet.name}</h2>
        <p className="mb-5 mt-2 line-clamp-2 min-h-10 text-sm leading-relaxed text-[#9CA6A0]">{playerSet.description || 'Your custom player pool, ready for the auction.'}</p>
        <div className="mb-5 flex items-center gap-3 border-y border-[#2A312D] py-4"><Users className="h-5 w-5 text-[#C9A227]" /><span className="font-mono text-2xl font-semibold tabular-nums">{totalPlayers.toLocaleString()}</span><span className="text-xs text-[#9CA6A0]">players in this set</span></div>
        <div className="mb-3 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-[#9CA6A0]"><span>Category breakdown</span><span>5 tiers</span></div>
        <div className="mb-3 flex h-1.5 overflow-hidden rounded-full bg-[#242E27]" aria-hidden="true">{tiers.map(tier => <div key={tier.label} className="h-full" style={{backgroundColor:tier.color,width:totalPlayers ? (tier.count / totalPlayers * 100) + '%' : '0%'}} />)}</div>
        <dl className="grid grid-cols-5 gap-1">{tiers.map(tier => <div key={tier.label} className="min-w-0 rounded-md bg-[#0B0F0D] py-2 text-center"><dt className="text-[9px] font-semibold sm:text-[10px]" style={{color:tier.color}}>{tier.label}</dt><dd className="mt-1 font-mono text-sm font-semibold tabular-nums">{tier.count}</dd></div>)}</dl>
      </div>
      <footer className="border-t border-[#2A312D] bg-[#101512] p-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] text-[#9CA6A0]"><Calendar className="h-3.5 w-3.5" />{formattedDate}</p>
          {isOwner && <div className="flex gap-1">{onEdit && <button type="button" onClick={() => onEdit(playerSet)} aria-label={'Edit ' + playerSet.name} title="Edit player set" className="flex h-11 w-11 items-center justify-center rounded-lg text-[#9CA6A0] hover:bg-[#242E27] hover:text-[#E4B93F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"><Edit className="h-4 w-4" /></button>}{onDelete && <button type="button" onClick={() => onDelete(playerSet)} aria-label={'Delete ' + playerSet.name} title="Delete player set" className="flex h-11 w-11 items-center justify-center rounded-lg text-[#9CA6A0] hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]"><Trash2 className="h-4 w-4" /></button>}</div>}
        </div>
        <Link href={'/player-sets/' + playerSet.id} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-[#C9A227]/45 bg-[#C9A227]/10 px-4 text-sm font-semibold text-[#E4B93F] transition-colors hover:bg-[#C9A227] hover:text-[#0B0F0D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]">Open player set<ArrowRight className="h-4 w-4" /></Link>
      </footer>
    </article>
  );
}
