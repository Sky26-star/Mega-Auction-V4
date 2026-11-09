'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface PlayerSetOption {
  id: string;
  name: string;
  playerCount: number;
  typeLabel: string;
}

interface PlayerSetComboboxProps {
  value: string;
  options: PlayerSetOption[];
  onValueChange: (value: string) => void;
}

export function PlayerSetCombobox({ value, options, onValueChange }: PlayerSetComboboxProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedOption = options.find(option => option.id === value);

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return options;
    return options.filter(option =>
      `${option.name} ${option.typeLabel} ${option.playerCount}`.toLocaleLowerCase().includes(query)
    );
  }, [options, search]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const activeOption = document.getElementById(`${listboxId}-option-${activeIndex}`);
    activeOption?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen, listboxId]);

  const openList = () => {
    setSearch('');
    setActiveIndex(Math.max(0, options.findIndex(option => option.id === value)));
    setIsOpen(true);
  };

  const closeList = () => {
    setIsOpen(false);
    setSearch('');
    setActiveIndex(-1);
  };

  const selectOption = (option: PlayerSetOption) => {
    onValueChange(option.id);
    closeList();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      if (!filteredOptions.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const start = activeIndex < 0 ? (step > 0 ? -1 : 0) : activeIndex;
      setActiveIndex((start + step + filteredOptions.length) % filteredOptions.length);
      return;
    }

    if (event.key === 'Home' && isOpen && filteredOptions.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && isOpen && filteredOptions.length) {
      event.preventDefault();
      setActiveIndex(filteredOptions.length - 1);
      return;
    }
    if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      if (filteredOptions[activeIndex]) selectOption(filteredOptions[activeIndex]);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      closeList();
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={event => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) closeList();
      }}
    >
      <div className={`flex items-center rounded-xl border bg-[#0B0F0D] transition-colors ${
        isOpen
          ? 'border-[#C9A227]/70 ring-2 ring-[#C9A227]/20 shadow-lg shadow-black/25'
          : 'border-[#2A312D] hover:border-[#59645D]'
      }`}>
        <input
          ref={inputRef}
          id="player-set-select"
          type="text"
          required
          role="combobox"
          aria-labelledby="player-set-label"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          autoComplete="off"
          value={isOpen ? search : selectedOption?.name ?? ''}
          placeholder={isOpen ? 'Search player sets…' : 'Select a player set'}
          onFocus={() => {
            if (!isOpen) openList();
          }}
          onClick={() => {
            if (!isOpen) openList();
          }}
          onChange={event => {
            setSearch(event.target.value);
            setActiveIndex(event.target.value ? 0 : Math.max(0, options.findIndex(option => option.id === value)));
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-xs text-[#F3F4F1] outline-none placeholder:text-[#77817A] sm:text-sm"
        />
        <ChevronDown
          aria-hidden="true"
          className={`mr-3 h-4 w-4 shrink-0 text-[#C9A227] transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>

      {isOpen && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-[#3A423D] bg-[#111613] shadow-xl shadow-black/35">
          <div
            id={listboxId}
            role="listbox"
            aria-label="Available player sets"
            className="max-h-72 overflow-y-auto p-1.5 [scrollbar-color:#59645D_#111613] [scrollbar-width:thin]"
          >
            {filteredOptions.length ? filteredOptions.map((option, index) => {
              const isSelected = option.id === value;
              const isActive = index === activeIndex;
              return (
                <div
                  key={option.id}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    isSelected
                      ? 'bg-[#C9A227]/10 text-[#F3F4F1]'
                      : isActive
                        ? 'bg-[#202722] text-[#F3F4F1]'
                        : 'text-[#D0D6D1] hover:bg-[#1A211D]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-semibold leading-5">{option.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-medium uppercase tracking-wide text-[#929D95]">
                      <span>{option.playerCount} players</span>
                      <span aria-hidden="true" className="text-[#58625B]">•</span>
                      <span>{option.typeLabel}</span>
                    </span>
                  </span>
                  {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[#E4B93F]" />}
                </div>
              );
            }) : (
              <p className="px-3 py-4 text-center text-xs text-[#929D95]">No player sets match your search.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
