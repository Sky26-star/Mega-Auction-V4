import React, { useState, useEffect, useMemo, useId, useRef } from 'react';
import { getPlayersBySetId } from '@/lib/player-sets';
import { Player } from '@/lib/types/player-set';
import { Loader2, Check, Search, ChevronDown } from 'lucide-react';

interface Props {
  playerSetId: string;
  onChange: (selectedPlayerIds: string[]) => void;
}

type Mode = 'ALL' | 'BY_CATEGORY' | 'BY_ROLE' | 'MANUAL';

interface ThemedSelectOption {
  value: string;
  label: string;
}

interface ThemedSelectProps {
  value: string;
  options: ThemedSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  testId: string;
  disabled?: boolean;
  className?: string;
}

function ThemedSelect({ value, options, onChange, ariaLabel, testId, disabled, className = '' }: ThemedSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedIndex = options.findIndex(option => option.value === value);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen, listboxId]);

  const openList = () => {
    setActiveIndex(Math.max(0, selectedIndex));
    setIsOpen(true);
  };

  const selectOption = (option: ThemedSelectOption) => {
    onChange(option.value);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      if (!options.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const start = activeIndex < 0 ? (step > 0 ? -1 : 0) : activeIndex;
      setActiveIndex((start + step + options.length) % options.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !isOpen) {
      event.preventDefault();
      openList();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && isOpen) {
      event.preventDefault();
      if (options[activeIndex]) selectOption(options[activeIndex]);
      return;
    }
    if (event.key === 'Home' && isOpen && options.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && isOpen && options.length) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onBlur={event => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setIsOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        data-testid={testId}
        disabled={disabled}
        onClick={() => isOpen ? setIsOpen(false) : openList()}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${
          isOpen
            ? 'border-[#C9A227]/70 bg-[#101512] text-[#F3F4F1] shadow-lg shadow-black/25'
            : 'border-[#2A312D] bg-[#0B0F0D] text-[#D0D6D1] hover:border-[#59645D] hover:text-[#F3F4F1]'
        }`}
      >
        <span className="min-w-0 truncate">{options.find(option => option.value === value)?.label ?? ''}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[#C9A227] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute right-0 z-40 mt-2 min-w-full overflow-hidden rounded-xl border border-[#3A423D] bg-[#111613] shadow-xl shadow-black/35">
          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-64 overflow-y-auto p-1.5 [scrollbar-color:#59645D_#111613] [scrollbar-width:thin]"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <div
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={`cursor-pointer whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
                    isSelected
                      ? 'bg-[#C9A227]/10 text-[#E4B93F]'
                      : isActive
                        ? 'bg-[#202722] text-[#F3F4F1]'
                        : 'text-[#D0D6D1] hover:bg-[#1A211D] hover:text-[#F3F4F1]'
                  }`}
                >
                  {option.label}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function RoomPlayerPoolSelector({ playerSetId, onChange }: Props) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
          onChangeRef.current(data.map(p => p.id));
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
      <div className="flex flex-wrap gap-2" role="group" aria-label="Player pool selection mode">
        <button type="button" aria-pressed={mode === 'ALL'} onClick={() => handleModeChange('ALL')} className={`rounded-xl border px-4 py-2.5 text-xs font-bold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${mode === 'ALL' ? 'border-[#C9A227]/60 bg-[#1A211D] text-[#E4B93F] shadow-sm shadow-black/20' : 'border-[#2A312D] bg-[#0B0F0D] text-[#9CA6A0] hover:border-[#59645D] hover:text-[#F3F4F1]'}`}>FULL SET ({players.length})</button>
        <button type="button" aria-pressed={mode === 'BY_CATEGORY'} onClick={() => handleModeChange('BY_CATEGORY')} className={`rounded-xl border px-4 py-2.5 text-xs font-bold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${mode === 'BY_CATEGORY' ? 'border-[#C9A227]/60 bg-[#1A211D] text-[#E4B93F] shadow-sm shadow-black/20' : 'border-[#2A312D] bg-[#0B0F0D] text-[#9CA6A0] hover:border-[#59645D] hover:text-[#F3F4F1]'}`}>BY CATEGORY</button>
        <button type="button" aria-pressed={mode === 'BY_ROLE'} onClick={() => handleModeChange('BY_ROLE')} className={`rounded-xl border px-4 py-2.5 text-xs font-bold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${mode === 'BY_ROLE' ? 'border-[#C9A227]/60 bg-[#1A211D] text-[#E4B93F] shadow-sm shadow-black/20' : 'border-[#2A312D] bg-[#0B0F0D] text-[#9CA6A0] hover:border-[#59645D] hover:text-[#F3F4F1]'}`}>BY ROLE</button>
        <button type="button" aria-pressed={mode === 'MANUAL'} onClick={() => handleModeChange('MANUAL')} className={`rounded-xl border px-4 py-2.5 text-xs font-bold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${mode === 'MANUAL' ? 'border-[#C9A227]/60 bg-[#1A211D] text-[#E4B93F] shadow-sm shadow-black/20' : 'border-[#2A312D] bg-[#0B0F0D] text-[#9CA6A0] hover:border-[#59645D] hover:text-[#F3F4F1]'}`}>MANUAL SELECT</button>
      </div>

      {loading ? (
        <div className="flex items-center space-x-2 text-xs text-[#9CA6A0] py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[#C9A227]" />
          <span>Loading player pool...</span>
        </div>
      ) : (
        <div className="rounded-xl border border-[#2A312D] bg-[#0B0F0D] p-4 shadow-inner shadow-black/20">
          {mode !== 'MANUAL' && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2A312D] bg-[#141917] p-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#B4BDB7] sm:text-sm">Select Player Count</span>
              <ThemedSelect
                testId="pool-count"
                ariaLabel="Select Player Count"
                value={limit === 'ALL' ? 'ALL' : String(limit)}
                onChange={handleLimitChange}
                disabled={maxAvailable === 0}
                className="w-full sm:w-auto sm:min-w-32"
                options={getCountOptions(maxAvailable).map(n => ({
                  value: n === maxAvailable ? 'ALL' : String(n),
                  label: n === maxAvailable ? `ALL (${n})` : String(n),
                }))}
              />
            </div>
          )}

          {mode === 'BY_CATEGORY' && (
              <div className="flex flex-wrap gap-2.5">
              {categories.map(c => (
                <button type="button" key={c} aria-pressed={selectedCategories.includes(c)} onClick={() => toggleCategory(c)} className={`rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${selectedCategories.includes(c) ? 'border-[#C9A227]/60 bg-[#C9A227]/10 text-[#E4B93F]' : 'border-[#2A312D] bg-[#141917] text-[#9CA6A0] hover:border-[#59645D] hover:text-[#F3F4F1]'}`}>
                  Category {c} ({players.filter(p => p.category === c).length})
                </button>
              ))}
            </div>
          )}
          {mode === 'BY_ROLE' && (
              <div className="flex flex-wrap gap-2.5">
              {roles.map(r => (
                <button type="button" key={r} aria-pressed={selectedRoles.includes(r)} onClick={() => toggleRole(r)} className={`rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${selectedRoles.includes(r) ? 'border-[#C9A227]/60 bg-[#C9A227]/10 text-[#E4B93F]' : 'border-[#2A312D] bg-[#141917] text-[#9CA6A0] hover:border-[#59645D] hover:text-[#F3F4F1]'}`}>
                  {r.replace('_', ' ')} ({players.filter(p => p.role === r).length})
                </button>
              ))}
            </div>
          )}
          {mode === 'MANUAL' && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <div className="flex flex-1 items-center space-x-2 rounded-lg border border-[#2A312D] bg-[#141917] px-3 py-2.5 transition-colors focus-within:border-[#C9A227]/70 focus-within:ring-2 focus-within:ring-[#C9A227]/20">
                  <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[#C9A227]" />
                  <input type="text" placeholder="Search players..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-transparent text-sm text-[#F3F4F1] outline-none placeholder:text-[#77817A]" />
                </div>
                <ThemedSelect
                  testId="pool-role-filter"
                  ariaLabel="Filter by Role"
                  value={manualRoleFilter}
                  onChange={setManualRoleFilter}
                  className="w-full sm:w-auto sm:min-w-48"
                  options={[
                    { value: 'ALL', label: 'Filter by Role (All)' },
                    ...roles.map(r => ({ value: r, label: r.replace('_', ' ') })),
                  ]}
                />
                <ThemedSelect
                  testId="pool-category-filter"
                  ariaLabel="Filter by Category"
                  value={manualCategoryFilter}
                  onChange={setManualCategoryFilter}
                  className="w-full sm:w-auto sm:min-w-48"
                  options={[
                    { value: 'ALL', label: 'Filter by Category (All)' },
                    ...categories.map(c => ({ value: c, label: `Category ${c}` })),
                  ]}
                />
              </div>
              <div className="max-h-60 space-y-1 overflow-y-auto pr-2 [scrollbar-color:#59645D_#0B0F0D] [scrollbar-width:thin]">
                {filteredManualPlayers.map(p => (
                  <button type="button" key={p.id} aria-pressed={selectedPlayers.includes(p.id)} onClick={() => togglePlayer(p.id)} className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${selectedPlayers.includes(p.id) ? 'border-[#C9A227]/40 bg-[#C9A227]/10' : 'border-transparent hover:border-[#2A312D] hover:bg-[#181E1A]'}`}>
                    <div>
                      <span className={`text-sm ${selectedPlayers.includes(p.id) ? 'font-bold text-[#E4B93F]' : 'font-medium text-[#F3F4F1]'}`}>{p.name}</span>
                      <span className="ml-2 text-xs text-[#9CA6A0]">{p.role.replace('_', ' ')} • {p.category}</span>
                    </div>
                    {selectedPlayers.includes(p.id) && <Check aria-hidden="true" className="h-4 w-4 text-[#E4B93F]" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#2A312D] pt-4 text-xs">
            <span className="text-[#9CA6A0] font-semibold uppercase tracking-wider">Active Room Pool Size</span>
            <span className="px-3 py-1 rounded-full bg-[#141917] border border-[#2A312D] text-[#E4B93F] font-bold font-mono-numbers">{poolCount} Players Selected</span>
          </div>
        </div>
      )}
    </div>
  );
}
