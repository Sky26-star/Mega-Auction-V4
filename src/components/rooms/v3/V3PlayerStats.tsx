import React from 'react';
import { V3Player, V3PlayerRole } from '@/lib/v3-auction-types';

interface V3PlayerStatsProps {
  player: V3Player;
}

// Returns true only if the value is a valid number (not null, undefined, or NaN).
// Zero is valid — the DB CSV parser already nullifies inapplicable stats per role at import time.
// So null === "not applicable for this player", while 0 can be genuine data (e.g., 0 hundreds).
function isValidNum(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && !isNaN(v as number);
}

// Returns true only if the string is non-empty (e.g., best_bowling "5/14")
function isValidStr(v: string | null | undefined): v is string {
  return v !== null && v !== undefined && v.trim() !== '';
}

interface StatCardProps {
  label: string;
  value: string | number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="flex flex-col bg-[#0B0F0D] border border-[#2A312D] rounded-xl p-3 min-w-0">
      <span className="text-[9px] font-mono font-bold text-[#9CA6A0] uppercase tracking-widest leading-none mb-1.5 truncate">
        {label}
      </span>
      <span className="text-sm font-mono-numbers font-bold text-[#F3F4F1] leading-none tabular-nums truncate">
        {value}
      </span>
    </div>
  );
}

interface StatGroupProps {
  title: string;
  accentClass?: string;
  children: React.ReactNode;
}

function StatGroup({ title, accentClass = 'text-[#C9A227]', children }: StatGroupProps) {
  return (
    <div className="space-y-2">
      <h4 className={`text-[9px] font-mono font-black uppercase tracking-[0.2em] ${accentClass}`}>
        {title}
      </h4>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {children}
      </div>
    </div>
  );
}

export function V3PlayerStats({ player }: V3PlayerStatsProps) {
  const role: V3PlayerRole = player.role;

  // ── BATSMAN ───────────────────────────────────────────────────
  if (role === 'BATSMAN') {
    const cards: React.ReactNode[] = [];
    if (isValidNum(player.matches))         cards.push(<StatCard key="matches"  label="Matches"    value={player.matches} />);
    if (isValidNum(player.runs))            cards.push(<StatCard key="runs"     label="Runs"       value={player.runs.toLocaleString()} />);
    if (isValidNum(player.batting_average)) cards.push(<StatCard key="avg"      label="Average"    value={Number(player.batting_average).toFixed(2)} />);
    if (isValidNum(player.strike_rate))     cards.push(<StatCard key="sr"       label="Strike Rate" value={Number(player.strike_rate).toFixed(2)} />);
    if (isValidNum(player.highest_score))   cards.push(<StatCard key="hs"       label="Highest"    value={player.highest_score} />);
    if (isValidNum(player.hundreds))        cards.push(<StatCard key="100s"     label="100s"       value={player.hundreds} />);
    if (isValidNum(player.fifties))         cards.push(<StatCard key="50s"      label="50s"        value={player.fifties} />);
    if (isValidNum(player.boundaries))      cards.push(<StatCard key="bounds"   label="Boundaries" value={player.boundaries.toLocaleString()} />);

    if (cards.length === 0) return null;
    return (
      <div className="space-y-3 pt-3 border-t border-[#2A312D]/50">
        <h3 className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-[#9CA6A0]">
          Player Stats
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {cards}
        </div>
      </div>
    );
  }

  // ── BOWLER ────────────────────────────────────────────────────
  if (role === 'BOWLER') {
    const cards: React.ReactNode[] = [];
    if (isValidNum(player.matches))              cards.push(<StatCard key="matches" label="Matches"     value={player.matches} />);
    if (isValidNum(player.wickets))              cards.push(<StatCard key="wickets" label="Wickets"     value={player.wickets} />);
    if (isValidNum(player.bowling_average))      cards.push(<StatCard key="bowlavg" label="Bowl Avg"    value={Number(player.bowling_average).toFixed(2)} />);
    if (isValidNum(player.economy_rate))         cards.push(<StatCard key="econ"    label="Economy"     value={Number(player.economy_rate).toFixed(2)} />);
    if (isValidNum(player.bowling_strike_rate))  cards.push(<StatCard key="bsr"     label="Bowl SR"     value={Number(player.bowling_strike_rate).toFixed(2)} />);
    if (isValidStr(player.best_bowling))         cards.push(<StatCard key="bb"      label="Best Bowling" value={player.best_bowling} />);
    if (isValidNum(player.three_wicket_hauls))   cards.push(<StatCard key="3w"      label="3W Hauls"    value={player.three_wicket_hauls} />);

    if (cards.length === 0) return null;
    return (
      <div className="space-y-3 pt-3 border-t border-[#2A312D]/50">
        <h3 className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-[#9CA6A0]">
          Player Stats
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {cards}
        </div>
      </div>
    );
  }

  // ── ALL-ROUNDER ───────────────────────────────────────────────
  if (role === 'ALL_ROUNDER') {
    const battingCards: React.ReactNode[] = [];
    if (isValidNum(player.matches))         battingCards.push(<StatCard key="matches"  label="Matches"    value={player.matches} />);
    if (isValidNum(player.runs))            battingCards.push(<StatCard key="runs"     label="Runs"       value={player.runs.toLocaleString()} />);
    if (isValidNum(player.batting_average)) battingCards.push(<StatCard key="avg"      label="Average"    value={Number(player.batting_average).toFixed(2)} />);
    if (isValidNum(player.strike_rate))     battingCards.push(<StatCard key="sr"       label="Strike Rate" value={Number(player.strike_rate).toFixed(2)} />);
    if (isValidNum(player.highest_score))   battingCards.push(<StatCard key="hs"       label="Highest"    value={player.highest_score} />);

    const bowlingCards: React.ReactNode[] = [];
    // Only push matches in bowling if batting is completely empty
    if (battingCards.length === 0 && isValidNum(player.matches)) {
      bowlingCards.push(<StatCard key="matches" label="Matches" value={player.matches} />);
    }
    if (isValidNum(player.wickets))              bowlingCards.push(<StatCard key="wickets" label="Wickets"     value={player.wickets} />);
    if (isValidNum(player.economy_rate))         bowlingCards.push(<StatCard key="econ"    label="Economy"     value={Number(player.economy_rate).toFixed(2)} />);
    if (isValidStr(player.best_bowling))         bowlingCards.push(<StatCard key="bb"      label="Best Bowling" value={player.best_bowling} />);
    if (isValidNum(player.three_wicket_hauls))   bowlingCards.push(<StatCard key="3w"      label="3W Hauls"    value={player.three_wicket_hauls} />);

    const hasBatting = battingCards.length > 0;
    const hasBowling = bowlingCards.length > 0;
    if (!hasBatting && !hasBowling) return null;

    return (
      <div className="space-y-4 pt-3 border-t border-[#2A312D]/50">
        <h3 className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-[#9CA6A0]">
          Player Stats
        </h3>
        {hasBatting && (
          <StatGroup title="Batting">
            {battingCards}
          </StatGroup>
        )}
        {hasBowling && (
          <StatGroup title="Bowling" accentClass="text-[#34D399]">
            {bowlingCards}
          </StatGroup>
        )}
      </div>
    );
  }

  // ── WICKET_KEEPER ─────────────────────────────────────────────
  if (role === 'WICKET_KEEPER') {
    const battingCards: React.ReactNode[] = [];
    if (isValidNum(player.matches))         battingCards.push(<StatCard key="matches"  label="Matches"    value={player.matches} />);
    if (isValidNum(player.runs))            battingCards.push(<StatCard key="runs"     label="Runs"       value={player.runs.toLocaleString()} />);
    if (isValidNum(player.batting_average)) battingCards.push(<StatCard key="avg"      label="Average"    value={Number(player.batting_average).toFixed(2)} />);
    if (isValidNum(player.strike_rate))     battingCards.push(<StatCard key="sr"       label="Strike Rate" value={Number(player.strike_rate).toFixed(2)} />);
    if (isValidNum(player.highest_score))   battingCards.push(<StatCard key="hs"       label="Highest"    value={player.highest_score} />);
    if (isValidNum(player.hundreds))        battingCards.push(<StatCard key="100s"     label="100s"       value={player.hundreds} />);
    if (isValidNum(player.fifties))         battingCards.push(<StatCard key="50s"      label="50s"        value={player.fifties} />);
    if (isValidNum(player.boundaries))      battingCards.push(<StatCard key="bounds"   label="Boundaries" value={player.boundaries.toLocaleString()} />);

    const keepingCards: React.ReactNode[] = [];
    if (isValidNum(player.catches))   keepingCards.push(<StatCard key="catches"   label="Catches"   value={player.catches} />);
    if (isValidNum(player.stumpings)) keepingCards.push(<StatCard key="stumpings" label="Stumpings" value={player.stumpings} />);

    const hasBatting = battingCards.length > 0;
    const hasKeeping = keepingCards.length > 0;
    if (!hasBatting && !hasKeeping) return null;

    return (
      <div className="space-y-4 pt-3 border-t border-[#2A312D]/50">
        <h3 className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-[#9CA6A0]">
          Player Stats
        </h3>
        {hasBatting && (
          <StatGroup title="Batting">
            {battingCards}
          </StatGroup>
        )}
        {hasKeeping && (
          <StatGroup title="Wicketkeeping" accentClass="text-[#60A5FA]">
            {keepingCards}
          </StatGroup>
        )}
      </div>
    );
  }

  return null;
}
