'use client';

// src/components/player-sets/player-modal.tsx
// Player Manual Entry & Edit Modal (Player Master Data V2)

import React, { useState, useEffect } from 'react';
import type { Player, PlayerFormInput, PlayerRole, PlayerCategory } from '@/lib/types/player-set';
import { CATEGORY_UI_LABELS, CATEGORY_BASE_PRICES } from '@/lib/types/player-set';
import { playerSchema, PLAYER_ROLES, PLAYER_CATEGORIES } from '@/lib/validations/player-set';
import { X, User, Loader2, AlertCircle, Globe } from 'lucide-react';

interface PlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: PlayerFormInput) => Promise<void>;
  initialData?: Player | null;
}

export function PlayerModal({ isOpen, onClose, onSubmit, initialData }: PlayerModalProps) {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('India');
  const [role, setRole] = useState<PlayerRole>('BATSMAN');
  const [category, setCategory] = useState<PlayerCategory>('C');
  const [basePrice, setBasePrice] = useState<number>(75);
  const [imageUrl, setImageUrl] = useState('');
  const [age, setAge] = useState<string>('');
  const [battingHand, setBattingHand] = useState('');

  // Batting Stats
  const [matches, setMatches] = useState<string>('');
  const [runs, setRuns] = useState<string>('');
  const [battingAverage, setBattingAverage] = useState<string>('');
  const [strikeRate, setStrikeRate] = useState<string>('');
  const [hundreds, setHundreds] = useState<string>('');
  const [fifties, setFifties] = useState<string>('');
  const [highestScore, setHighestScore] = useState<string>('');
  const [boundaries, setBoundaries] = useState<string>('');

  // Bowling Stats
  const [overs, setOvers] = useState<string>('');
  const [wickets, setWickets] = useState<string>('');
  const [bowlingAverage, setBowlingAverage] = useState<string>('');
  const [economyRate, setEconomyRate] = useState<string>('');
  const [bowlingStrikeRate, setBowlingStrikeRate] = useState<string>('');
  const [bestBowling, setBestBowling] = useState<string>('');
  const [threeWicketHauls, setThreeWicketHauls] = useState<string>('');

  // Keeping Stats
  const [catches, setCatches] = useState<string>('');
  const [stumpings, setStumpings] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '');
      setCountry(initialData.country || 'India');
      setRole(initialData.role || 'BATSMAN');
      setCategory(initialData.category || 'C');
      setBasePrice(initialData.base_price || CATEGORY_BASE_PRICES[initialData.category || 'C']);
      setImageUrl(initialData.image_url || '');
      setAge(initialData.age !== null && initialData.age !== undefined ? String(initialData.age) : '');
      setBattingHand(initialData.batting_hand || '');

      setMatches(initialData.matches !== null && initialData.matches !== undefined ? String(initialData.matches) : '');
      setRuns(initialData.runs !== null && initialData.runs !== undefined ? String(initialData.runs) : '');
      setBattingAverage(initialData.batting_average !== null && initialData.batting_average !== undefined ? String(initialData.batting_average) : '');
      setStrikeRate(initialData.strike_rate !== null && initialData.strike_rate !== undefined ? String(initialData.strike_rate) : '');
      setHundreds(initialData.hundreds !== null && initialData.hundreds !== undefined ? String(initialData.hundreds) : '');
      setFifties(initialData.fifties !== null && initialData.fifties !== undefined ? String(initialData.fifties) : '');
      setHighestScore(initialData.highest_score !== null && initialData.highest_score !== undefined ? String(initialData.highest_score) : '');
      setBoundaries(initialData.boundaries !== null && initialData.boundaries !== undefined ? String(initialData.boundaries) : '');

      setOvers(initialData.overs !== null && initialData.overs !== undefined ? String(initialData.overs) : '');
      setWickets(initialData.wickets !== null && initialData.wickets !== undefined ? String(initialData.wickets) : '');
      setBowlingAverage(initialData.bowling_average !== null && initialData.bowling_average !== undefined ? String(initialData.bowling_average) : '');
      setEconomyRate(initialData.economy_rate !== null && initialData.economy_rate !== undefined ? String(initialData.economy_rate) : '');
      setBowlingStrikeRate(initialData.bowling_strike_rate !== null && initialData.bowling_strike_rate !== undefined ? String(initialData.bowling_strike_rate) : '');
      setBestBowling(initialData.best_bowling || '');
      setThreeWicketHauls(initialData.three_wicket_hauls !== null && initialData.three_wicket_hauls !== undefined ? String(initialData.three_wicket_hauls) : '');

      setCatches(initialData.catches !== null && initialData.catches !== undefined ? String(initialData.catches) : '');
      setStumpings(initialData.stumpings !== null && initialData.stumpings !== undefined ? String(initialData.stumpings) : '');
    } else {
      setName('');
      setCountry('India');
      setRole('BATSMAN');
      setCategory('C');
      setBasePrice(75);
      setImageUrl('');
      setAge('');
      setBattingHand('');

      setMatches('');
      setRuns('');
      setBattingAverage('');
      setStrikeRate('');
      setHundreds('');
      setFifties('');
      setHighestScore('');
      setBoundaries('');
      setOvers('');
      setWickets('');
      setBowlingAverage('');
      setEconomyRate('');
      setBowlingStrikeRate('');
      setBestBowling('');
      setThreeWicketHauls('');
      setCatches('');
      setStumpings('');
    }
    setError(null);
    setFieldErrors({});
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const isOverseas = country.trim().toLowerCase() !== 'india';

  const handleCategoryChange = (newCat: PlayerCategory) => {
    setCategory(newCat);
    if (!initialData) {
      setBasePrice(CATEGORY_BASE_PRICES[newCat]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const parseNum = (val: string): number | null => (val.trim() === '' ? null : Number(val));
    const parseStr = (val: string): string | null => (val.trim() === '' ? null : val.trim());

    // Role-based null logic
    let finalMatches = parseNum(matches);
    let finalRuns: number | null = null;
    let finalBattingAvg: number | null = null;
    let finalStrikeRate: number | null = null;
    let finalHundreds: number | null = null;
    let finalFifties: number | null = null;
    let finalHighestScore: number | null = null;
    let finalBoundaries: number | null = null;

    let finalOvers: number | null = null;
    let finalWickets: number | null = null;
    let finalBowlingAvg: number | null = null;
    let finalEconomyRate: number | null = null;
    let finalBowlingStrikeRate: number | null = null;
    let finalBestBowling: string | null = null;
    let finalThreeWicketHauls: number | null = null;

    let finalCatches: number | null = null;
    let finalStumpings: number | null = null;

    if (role === 'BATSMAN') {
      finalRuns = parseNum(runs);
      finalBattingAvg = parseNum(battingAverage);
      finalStrikeRate = parseNum(strikeRate);
      finalHundreds = parseNum(hundreds);
      finalFifties = parseNum(fifties);
      finalHighestScore = parseNum(highestScore);
      finalBoundaries = parseNum(boundaries);
    } else if (role === 'BOWLER') {
      finalOvers = parseNum(overs);
      finalWickets = parseNum(wickets);
      finalBowlingAvg = parseNum(bowlingAverage);
      finalEconomyRate = parseNum(economyRate);
      finalBowlingStrikeRate = parseNum(bowlingStrikeRate);
      finalBestBowling = parseStr(bestBowling);
      finalThreeWicketHauls = parseNum(threeWicketHauls);
    } else if (role === 'ALL_ROUNDER') {
      finalRuns = parseNum(runs);
      finalBattingAvg = parseNum(battingAverage);
      finalStrikeRate = parseNum(strikeRate);
      finalHundreds = parseNum(hundreds);
      finalFifties = parseNum(fifties);
      finalHighestScore = parseNum(highestScore);
      finalBoundaries = parseNum(boundaries);
      finalOvers = parseNum(overs);
      finalWickets = parseNum(wickets);
      finalBowlingAvg = parseNum(bowlingAverage);
      finalEconomyRate = parseNum(economyRate);
      finalBowlingStrikeRate = parseNum(bowlingStrikeRate);
      finalBestBowling = parseStr(bestBowling);
      finalThreeWicketHauls = parseNum(threeWicketHauls);
    } else if (role === 'WICKET_KEEPER') {
      finalRuns = parseNum(runs);
      finalBattingAvg = parseNum(battingAverage);
      finalStrikeRate = parseNum(strikeRate);
      finalHundreds = parseNum(hundreds);
      finalFifties = parseNum(fifties);
      finalHighestScore = parseNum(highestScore);
      finalBoundaries = parseNum(boundaries);
      finalCatches = parseNum(catches);
      finalStumpings = parseNum(stumpings);
    }

    const payload: PlayerFormInput = {
      name: name.trim(),
      country: country.trim(),
      role,
      category,
      base_price: Number(basePrice),
      is_overseas: isOverseas,
      image_url: imageUrl.trim() || null,
      age: parseNum(age),
      batting_hand: parseStr(battingHand),

      matches: finalMatches,
      runs: finalRuns,
      batting_average: finalBattingAvg,
      strike_rate: finalStrikeRate,
      hundreds: finalHundreds,
      fifties: finalFifties,
      highest_score: finalHighestScore,
      boundaries: finalBoundaries,
      overs: finalOvers,
      wickets: finalWickets,
      bowling_average: finalBowlingAvg,
      economy_rate: finalEconomyRate,
      bowling_strike_rate: finalBowlingStrikeRate,
      best_bowling: finalBestBowling,
      three_wicket_hauls: finalThreeWicketHauls,
      catches: finalCatches,
      stumpings: finalStumpings,
    };

    const validation = playerSchema.safeParse(payload);

    if (!validation.success) {
      const formatted = validation.error.format();
      setFieldErrors({
        name: formatted.name?._errors[0] || '',
        country: formatted.country?._errors[0] || '',
        role: formatted.role?._errors[0] || '',
        category: formatted.category?._errors[0] || '',
        base_price: formatted.base_price?._errors[0] || '',
        image_url: formatted.image_url?._errors[0] || '',
      });
      return;
    }

    setIsLoading(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to save player');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {initialData ? 'Edit Player (V2)' : 'Add New Player (V2)'}
              </h2>
              <p className="text-xs text-slate-400">Specify player profile and role-specific stats</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start space-x-3 text-red-400 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Basic Info Group */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wider">Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="player-name" className="block font-semibold text-slate-300 mb-1">
                  Player Name *
                </label>
                <input
                  id="player-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jasprit Bumrah"
                  disabled={isLoading}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                {fieldErrors.name && <p className="mt-1 text-red-400">{fieldErrors.name}</p>}
              </div>

              <div>
                <label htmlFor="player-country" className="block font-semibold text-slate-300 mb-1">
                  Country *
                </label>
                <div className="relative">
                  <input
                    id="player-country"
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="e.g. India, Australia"
                    disabled={isLoading}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 pr-24"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-semibold text-slate-400">
                    <Globe className="w-3 h-3 text-violet-400" />
                    <span>{isOverseas ? 'Overseas' : 'Domestic'}</span>
                  </div>
                </div>
                {fieldErrors.country && <p className="mt-1 text-red-400">{fieldErrors.country}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="player-role" className="block font-semibold text-slate-300 mb-1">
                  Role *
                </label>
                <select
                  id="player-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as PlayerRole)}
                  disabled={isLoading}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {PLAYER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="player-age" className="block font-semibold text-slate-300 mb-1">
                  Age (Optional)
                </label>
                <input
                  id="player-age"
                  type="number"
                  min={0}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="e.g. 28"
                  disabled={isLoading}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="player-battinghand" className="block font-semibold text-slate-300 mb-1">
                  Batting Hand (Optional)
                </label>
                <input
                  id="player-battinghand"
                  type="text"
                  value={battingHand}
                  onChange={(e) => setBattingHand(e.target.value)}
                  placeholder="e.g. Right-hand bat"
                  disabled={isLoading}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          </div>

          {/* Auction Classification Group */}
          <div className="space-y-4 pt-3 border-t border-slate-800">
            <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wider">Auction Classification</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="player-category" className="block font-semibold text-slate-300 mb-1">
                  Category *
                </label>
                <select
                  id="player-category"
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value as PlayerCategory)}
                  disabled={isLoading}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {PLAYER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_UI_LABELS[c]} ({c})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="player-baseprice" className="block font-semibold text-slate-300 mb-1">
                  Base Price (Lakhs) *
                </label>
                <input
                  id="player-baseprice"
                  type="number"
                  min={1}
                  value={basePrice}
                  onChange={(e) => setBasePrice(Number(e.target.value))}
                  disabled={isLoading}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                {fieldErrors.base_price && <p className="mt-1 text-red-400">{fieldErrors.base_price}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="player-imageurl" className="block font-semibold text-slate-300 mb-1">
                Image URL (Optional)
              </label>
              <input
                id="player-imageurl"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/player.jpg"
                disabled={isLoading}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {fieldErrors.image_url && <p className="mt-1 text-red-400">{fieldErrors.image_url}</p>}
            </div>
          </div>

          {/* Role-Specific Stats Group */}
          <div className="space-y-4 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wider">
                IPL Career Statistics ({role.replace('_', ' ')})
              </h3>
              <span className="text-[10px] text-slate-500">8 Role Stats</span>
            </div>

            {/* BATSMAN STATS */}
            {role === 'BATSMAN' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Matches</label>
                  <input type="number" min={0} value={matches} onChange={(e) => setMatches(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Runs</label>
                  <input type="number" min={0} value={runs} onChange={(e) => setRuns(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Average</label>
                  <input type="number" step="0.01" min={0} value={battingAverage} onChange={(e) => setBattingAverage(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Strike Rate</label>
                  <input type="number" step="0.01" min={0} value={strikeRate} onChange={(e) => setStrikeRate(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">100s</label>
                  <input type="number" min={0} value={hundreds} onChange={(e) => setHundreds(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">50s</label>
                  <input type="number" min={0} value={fifties} onChange={(e) => setFifties(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Highest Score</label>
                  <input type="number" min={0} value={highestScore} onChange={(e) => setHighestScore(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Boundaries</label>
                  <input type="number" min={0} value={boundaries} onChange={(e) => setBoundaries(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
              </div>
            )}

            {/* BOWLER STATS */}
            {role === 'BOWLER' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Matches</label>
                  <input type="number" min={0} value={matches} onChange={(e) => setMatches(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Overs</label>
                  <input type="number" step="0.1" min={0} value={overs} onChange={(e) => setOvers(e.target.value)} placeholder="0.0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Wickets</label>
                  <input type="number" min={0} value={wickets} onChange={(e) => setWickets(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Bowling Avg</label>
                  <input type="number" step="0.01" min={0} value={bowlingAverage} onChange={(e) => setBowlingAverage(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Economy Rate</label>
                  <input type="number" step="0.01" min={0} value={economyRate} onChange={(e) => setEconomyRate(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Strike Rate</label>
                  <input type="number" step="0.01" min={0} value={bowlingStrikeRate} onChange={(e) => setBowlingStrikeRate(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Best Bowling</label>
                  <input type="text" value={bestBowling} onChange={(e) => setBestBowling(e.target.value)} placeholder="5/12" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">3-Wkt Hauls</label>
                  <input type="number" min={0} value={threeWicketHauls} onChange={(e) => setThreeWicketHauls(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
              </div>
            )}

            {/* ALL ROUNDER STATS */}
            {role === 'ALL_ROUNDER' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Matches</label>
                  <input type="number" min={0} value={matches} onChange={(e) => setMatches(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Runs</label>
                  <input type="number" min={0} value={runs} onChange={(e) => setRuns(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Batting Avg</label>
                  <input type="number" step="0.01" min={0} value={battingAverage} onChange={(e) => setBattingAverage(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Batting SR</label>
                  <input type="number" step="0.01" min={0} value={strikeRate} onChange={(e) => setStrikeRate(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Wickets</label>
                  <input type="number" min={0} value={wickets} onChange={(e) => setWickets(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Bowling Avg</label>
                  <input type="number" step="0.01" min={0} value={bowlingAverage} onChange={(e) => setBowlingAverage(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Economy Rate</label>
                  <input type="number" step="0.01" min={0} value={economyRate} onChange={(e) => setEconomyRate(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Best Bowling</label>
                  <input type="text" value={bestBowling} onChange={(e) => setBestBowling(e.target.value)} placeholder="5/12" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
              </div>
            )}

            {/* WICKET KEEPER STATS */}
            {role === 'WICKET_KEEPER' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Matches</label>
                  <input type="number" min={0} value={matches} onChange={(e) => setMatches(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Runs</label>
                  <input type="number" min={0} value={runs} onChange={(e) => setRuns(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Average</label>
                  <input type="number" step="0.01" min={0} value={battingAverage} onChange={(e) => setBattingAverage(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Strike Rate</label>
                  <input type="number" step="0.01" min={0} value={strikeRate} onChange={(e) => setStrikeRate(e.target.value)} placeholder="0.00" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">50s</label>
                  <input type="number" min={0} value={fifties} onChange={(e) => setFifties(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Highest Score</label>
                  <input type="number" min={0} value={highestScore} onChange={(e) => setHighestScore(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Catches</label>
                  <input type="number" min={0} value={catches} onChange={(e) => setCatches(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Stumpings</label>
                  <input type="number" min={0} value={stumpings} onChange={(e) => setStumpings(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-white" />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/30 flex items-center space-x-2 transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>{initialData ? 'Update Player' : 'Add Player'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
