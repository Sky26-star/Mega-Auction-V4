import React, { useState, useEffect, useMemo } from 'react';
import { getPlayersBySetId } from '@/lib/player-sets';
import { Player } from '@/lib/types/player-set';
import { Loader2, Users, Filter, Check, X, Search } from 'lucide-react';

interface Props {
  playerSetId: string;
  onChange: (selectedPlayerIds: string[]) => void;
}

type Mode = 'ALL' | 'BY_CATEGORY' | 'BY_ROLE' | 'MANUAL';

export function RoomPlayerPoolSelector({ playerSetId, onChange }: Props) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<Mode>('ALL');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState<number | 'ALL'>('ALL');
  const [manualRoleFilter, setManualRoleFilter] = useState<string>('ALL');
  const [manualCategoryFilter, setManualCategoryFilter] = useState<string>('ALL');

  const targetSetId = playerSetId === 'DEFAULT' ? '00000000-0000-0000-0000-000000000202' : playerSetId;

  useEffect(() => {
    let mounted = true;
    const fetchPlayers = async () => {
      setLoading(true);
      try {
        const data = await getPlayersBySetId(targetSetId);
        if (mounted) {
          setPlayers(data);
          // Always reset to ALL mode and ALL limit when player set changes
          setMode('ALL');
          setLimit('ALL');
          onChange(data.map(p => p.id));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchPlayers();
    return () => { mounted = false; };
  }, [targetSetId]);

  const categories = useMemo(() => Array.from(new Set(players.map(p => p.category))).sort(), [players]);
  const roles = useMemo(() => Array.from(new Set(players.map(p => p.role))).sort(), [players]);

  const updateSelection = (m: Mode, allPlayers: Player[], cats: string[], rols: string[], manuals: string[], limitVal: number | 'ALL') => {
    let pool: string[] = [];
    if (m === 'ALL') {
      pool = allPlayers.map(p => p.id);
    } else if (m === 'BY_CATEGORY') {
      pool = allPlayers.filter(p => cats.includes(p.category)).map(p => p.id);
    } else if (m === 'BY_ROLE') {
      pool = allPlayers.filter(p => rols.includes(p.role)).map(p => p.id);
    } else if (m === 'MANUAL') {
      pool = manuals;
    }

    if (m !== 'MANUAL' && limitVal !== 'ALL') {
      // Fisher-Yates shuffle to ensure a completely random sample
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = shuffled[i] as string;
        shuffled[i] = shuffled[j] as string;
        shuffled[j] = temp;
      }
      pool = shuffled.slice(0, limitVal);
    }

    onChange(pool);
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setLimit('ALL'); // Reset limit when changing modes
    if (newMode === 'ALL') {
      updateSelection(newMode, players, selectedCategories, selectedRoles, selectedPlayers, 'ALL');
    } else if (newMode === 'BY_CATEGORY') {
      setSelectedCategories(categories); // default select all
      updateSelection(newMode, players, categories, selectedRoles, selectedPlayers, 'ALL');
    } else if (newMode === 'BY_ROLE') {
      setSelectedRoles(roles);
      updateSelection(newMode, players, selectedCategories, roles, selectedPlayers, 'ALL');
    } else if (newMode === 'MANUAL') {
      setSelectedPlayers([]); // default select none
      updateSelection(newMode, players, selectedCategories, selectedRoles, [], 'ALL');
    }
  };

  const toggleCategory = (cat: string) => {
    const next = selectedCategories.includes(cat) ? selectedCategories.filter(c => c !== cat) : [...selectedCategories, cat];
    setSelectedCategories(next);
    updateSelection(mode, players, next, selectedRoles, selectedPlayers, limit);
  };

  const toggleRole = (role: string) => {
    const next = selectedRoles.includes(role) ? selectedRoles.filter(r => r !== role) : [...selectedRoles, role];
    setSelectedRoles(next);
    updateSelection(mode, players, selectedCategories, next, selectedPlayers, limit);
  };

  const togglePlayer = (id: string) => {
    const next = selectedPlayers.includes(id) ? selectedPlayers.filter(i => i !== id) : [...selectedPlayers, id];
    setSelectedPlayers(next);
    updateSelection(mode, players, selectedCategories, selectedRoles, next, limit);
  };

  const handleLimitChange = (val: string) => {
    const newLimit = val === 'ALL' ? 'ALL' : parseInt(val);
    setLimit(newLimit);
    updateSelection(mode, players, selectedCategories, selectedRoles, selectedPlayers, newLimit);
  };

  const filteredManualPlayers = players.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchRole = manualRoleFilter === 'ALL' || p.role === manualRoleFilter;
    const matchCat = manualCategoryFilter === 'ALL' || p.category === manualCategoryFilter;
    return matchSearch && matchRole && matchCat;
  });

  // Active pool count calculation
  const maxAvailable = mode === 'ALL' ? players.length :
    mode === 'BY_CATEGORY' ? players.filter(p => selectedCategories.includes(p.category)).length :
      mode === 'BY_ROLE' ? players.filter(p => selectedRoles.includes(p.role)).length :
        0;

  const poolCount = mode === 'MANUAL' ? selectedPlayers.length : (limit === 'ALL' ? maxAvailable : Math.min(limit, maxAvailable));

  const getCountOptions = (max: number) => {
    if (max === 0) return [];
    const options = [5, 10, 20, 25, 50, 100, 150, 200].filter(n => n < max);
    options.push(max);
    return Array.from(new Set(options)).sort((a, b) => a - b);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => handleModeChange('ALL')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${mode === 'ALL' ? 'bg-[#181E1A] text-[#E4B93F] border-[#C9A227]/40' : 'bg-[#0B0F0D] text-[#9CA6A0] border-[#2A312D] hover:text-[#F3F4F1]'}`}>FULL SET ({players.length})</button>
        <button type="button" onClick={() => handleModeChange('BY_CATEGORY')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${mode === 'BY_CATEGORY' ? 'bg-[#181E1A] text-[#E4B93F] border-[#C9A227]/40' : 'bg-[#0B0F0D] text-[#9CA6A0] border-[#2A312D] hover:text-[#F3F4F1]'}`}>BY CATEGORY</button>
        <button type="button" onClick={() => handleModeChange('BY_ROLE')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${mode === 'BY_ROLE' ? 'bg-[#181E1A] text-[#E4B93F] border-[#C9A227]/40' : 'bg-[#0B0F0D] text-[#9CA6A0] border-[#2A312D] hover:text-[#F3F4F1]'}`}>BY ROLE</button>
        <button type="button" onClick={() => handleModeChange('MANUAL')} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${mode === 'MANUAL' ? 'bg-[#181E1A] text-[#E4B93F] border-[#C9A227]/40' : 'bg-[#0B0F0D] text-[#9CA6A0] border-[#2A312D] hover:text-[#F3F4F1]'}`}>MANUAL SELECT</button>
      </div>

      {loading ? (
        <div className="flex items-center space-x-2 text-xs text-[#9CA6A0] py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[#C9A227]" />
          <span>Loading player pool...</span>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D]">
          {mode !== 'MANUAL' && (
            <div className="mb-4 flex items-center justify-between bg-[#141917] p-3 rounded-lg border border-[#2A312D]">
              <span className="text-sm font-semibold text-[#9CA6A0]">Select Player Count</span>
              <select
                data-testid="pool-count"
                value={limit === 'ALL' ? 'ALL' : limit}
                onChange={(e) => handleLimitChange(e.target.value)}
                className="bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] text-sm rounded-md px-3 py-1.5 focus:outline-none focus:border-[#C9A227]"
                disabled={maxAvailable === 0}
              >
                {getCountOptions(maxAvailable).map(n => (
                  <option key={n} value={n === maxAvailable ? 'ALL' : n}>
                    {n === maxAvailable ? `ALL (${n})` : n}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'BY_CATEGORY' && (
            <div className="flex flex-wrap gap-2">
              {categories.map(c => (
                <button type="button" key={c} onClick={() => toggleCategory(c)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${selectedCategories.includes(c) ? 'bg-[#C9A227]/20 border-[#C9A227]/60 text-[#E4B93F]' : 'bg-[#141917] border-[#2A312D] text-[#9CA6A0]'}`}>
                  Category {c} ({players.filter(p => p.category === c).length})
                </button>
              ))}
            </div>
          )}
          {mode === 'BY_ROLE' && (
            <div className="flex flex-wrap gap-2">
              {roles.map(r => (
                <button type="button" key={r} onClick={() => toggleRole(r)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${selectedRoles.includes(r) ? 'bg-[#C9A227]/20 border-[#C9A227]/60 text-[#E4B93F]' : 'bg-[#141917] border-[#2A312D] text-[#9CA6A0]'}`}>
                  {r.replace('_', ' ')} ({players.filter(p => p.role === r).length})
                </button>
              ))}
            </div>
          )}
          {mode === 'MANUAL' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 flex items-center space-x-2 bg-[#141917] border border-[#2A312D] px-3 py-2 rounded-lg">
                  <Search className="w-4 h-4 text-[#9CA6A0]" />
                  <input type="text" placeholder="Search players..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="bg-transparent text-sm text-[#F3F4F1] focus:outline-none w-full" />
                </div>
                <select
                  data-testid="pool-role-filter"
                  value={manualRoleFilter}
                  onChange={(e) => setManualRoleFilter(e.target.value)}
                  className="bg-[#141917] border border-[#2A312D] text-[#9CA6A0] text-sm rounded-lg px-3 py-2 focus:outline-none"
                >
                  <option value="ALL">Filter by Role (All)</option>
                  {roles.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>
                <select
                  data-testid="pool-category-filter"
                  value={manualCategoryFilter}
                  onChange={(e) => setManualCategoryFilter(e.target.value)}
                  className="bg-[#141917] border border-[#2A312D] text-[#9CA6A0] text-sm rounded-lg px-3 py-2 focus:outline-none"
                >
                  <option value="ALL">Filter by Category (All)</option>
                  {categories.map(c => <option key={c} value={c}>Category {c}</option>)}
                </select>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1 pr-2">
                {filteredManualPlayers.map(p => (
                  <button type="button" key={p.id} onClick={() => togglePlayer(p.id)} className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[#181E1A] border border-transparent hover:border-[#2A312D] text-left">
                    <div>
                      <span className={`text-sm ${selectedPlayers.includes(p.id) ? 'text-[#E4B93F] font-bold' : 'text-[#F3F4F1]'}`}>{p.name}</span>
                      <span className="text-xs text-[#9CA6A0] ml-2">{p.role.replace('_', ' ')} • {p.category}</span>
                    </div>
                    {selectedPlayers.includes(p.id) && <Check className="w-4 h-4 text-emerald-400" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-[#2A312D] flex items-center justify-between text-xs">
            <span className="text-[#9CA6A0] font-semibold uppercase tracking-wider">Active Room Pool Size</span>
            <span className="px-3 py-1 rounded-full bg-[#141917] border border-[#2A312D] text-[#E4B93F] font-bold font-mono-numbers">{poolCount} Players Selected</span>
          </div>
        </div>
      )}
    </div>
  );
}
