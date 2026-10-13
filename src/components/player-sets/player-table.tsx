'use client';

// src/components/player-sets/player-table.tsx
// High-Density Auction Database Table Component for Mega Auction V2

import React, { useState, useMemo } from 'react';
import type { Player } from '@/lib/types/player-set';
import { CATEGORY_UI_LABELS } from '@/lib/types/player-set';
import { Search, Filter, ArrowUpDown, Globe, Edit, Trash2, Eye, User as UserIcon, Database } from 'lucide-react';

interface PlayerTableProps {
  players: Player[];
  isOwner: boolean;
  onViewPlayer?: (player: Player) => void;
  onEditPlayer?: (player: Player) => void;
  onDeletePlayer?: (player: Player) => void;
}

export function PlayerTable({
  players,
  isOwner,
  onViewPlayer,
  onEditPlayer,
  onDeletePlayer,
}: PlayerTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [overseasFilter, setOverseasFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'price_asc' | 'price_desc'>('price_desc');

  const filteredPlayers = useMemo(() => {
    return players
      .filter((p) => {
        const searchLower = searchTerm.toLowerCase().trim();
        const matchesSearch =
          p.name.toLowerCase().includes(searchLower) ||
          (p.country && p.country.toLowerCase().includes(searchLower));
        const matchesRole = roleFilter === 'ALL' || p.role === roleFilter;
        const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
        const matchesOverseas =
          overseasFilter === 'ALL' ||
          (overseasFilter === 'OVERSEAS' && p.is_overseas) ||
          (overseasFilter === 'DOMESTIC' && !p.is_overseas);

        return matchesSearch && matchesRole && matchesCategory && matchesOverseas;
      })
      .sort((a, b) => {
        if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
        if (sortBy === 'name_desc') return b.name.localeCompare(a.name);
        if (sortBy === 'price_asc') return a.base_price - b.base_price;
        if (sortBy === 'price_desc') return b.base_price - a.base_price;
        return 0;
      });
  }, [players, searchTerm, roleFilter, categoryFilter, overseasFilter, sortBy]);

  return (
    <div className="space-y-4 font-sans">
      {/* Controls & Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-[#141917] border-2 border-[#2A312D] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA6A0]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search players by name or country..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#9CA6A0] focus:outline-none focus:border-[#7C3AED] text-xs font-medium transition-all"
          />
        </div>

        {/* Filters & Sorting */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Role Filter */}
          <div className="flex items-center space-x-1.5 bg-[#0B0F0D] border border-[#2A312D] rounded-xl px-2.5 py-1.5">
            <Filter className="w-3.5 h-3.5 text-[#A855F7]" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-transparent text-[#F3F4F1] focus:outline-none font-mono font-bold cursor-pointer"
            >
              <option value="ALL" className="bg-[#141917]">ALL ROLES</option>
              <option value="BATSMAN" className="bg-[#141917]">BATSMAN</option>
              <option value="BOWLER" className="bg-[#141917]">BOWLER</option>
              <option value="ALL_ROUNDER" className="bg-[#141917]">ALL ROUNDER</option>
              <option value="WICKET_KEEPER" className="bg-[#141917]">WICKET KEEPER</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center space-x-1.5 bg-[#0B0F0D] border border-[#2A312D] rounded-xl px-2.5 py-1.5">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent text-[#F3F4F1] focus:outline-none font-mono font-bold cursor-pointer"
            >
              <option value="ALL" className="bg-[#141917]">ALL CATEGORIES</option>
              <option value="MARQUEE" className="bg-[#141917]">ICON PLAYERS</option>
              <option value="A" className="bg-[#141917]">ELITE PLAYERS</option>
              <option value="B" className="bg-[#141917]">PREMIER PLAYERS</option>
              <option value="C" className="bg-[#141917]">CORE PLAYERS</option>
              <option value="D" className="bg-[#141917]">RISING STARS</option>
            </select>
          </div>

          {/* Overseas Filter */}
          <div className="flex items-center space-x-1.5 bg-[#0B0F0D] border border-[#2A312D] rounded-xl px-2.5 py-1.5">
            <select
              value={overseasFilter}
              onChange={(e) => setOverseasFilter(e.target.value)}
              className="bg-transparent text-[#F3F4F1] focus:outline-none font-mono font-bold cursor-pointer"
            >
              <option value="ALL" className="bg-[#141917]">ALL ORIGINS</option>
              <option value="DOMESTIC" className="bg-[#141917]">DOMESTIC</option>
              <option value="OVERSEAS" className="bg-[#141917]">OVERSEAS</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="flex items-center space-x-1.5 bg-[#0B0F0D] border border-[#2A312D] rounded-xl px-2.5 py-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#A855F7]" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-[#F3F4F1] focus:outline-none font-mono font-bold cursor-pointer"
            >
              <option value="price_desc" className="bg-[#141917]">PRICE: HIGH TO LOW</option>
              <option value="price_asc" className="bg-[#141917]">PRICE: LOW TO HIGH</option>
              <option value="name_asc" className="bg-[#141917]">NAME: A TO Z</option>
              <option value="name_desc" className="bg-[#141917]">NAME: Z TO A</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-2xl border-2 border-[#2A312D] bg-[#141917] shadow-xl">
        {filteredPlayers.length === 0 ? (
          <div className="p-12 text-center text-[#9CA6A0]">
            <Database className="w-10 h-10 mx-auto mb-3 text-[#A855F7]/50" />
            <p className="text-sm font-bold text-[#F3F4F1]">No players found matching current filters.</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs text-[#F3F4F1]">
            <thead className="bg-[#0B0F0D] text-[#9CA6A0] uppercase font-mono text-[10px] tracking-wider border-b-2 border-[#2A312D]">
              <tr>
                <th className="px-4 py-3.5">Player</th>
                <th className="px-4 py-3.5">Country</th>
                <th className="px-4 py-3.5">Role</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5">Base Price</th>
                <th className="px-4 py-3.5">Overseas</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A312D]">
              {filteredPlayers.map((player) => {
                const categoryLabel = CATEGORY_UI_LABELS[player.category] || player.category;

                return (
                  <tr key={player.id} className="hover:bg-[#181E1A] transition-colors group">
                    <td className="px-4 py-3 font-semibold text-white">
                      <div className="flex items-center gap-3">
                        {player.image_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={player.image_url}
                            alt={player.name}
                            className="w-8 h-8 rounded-full object-cover border-2 border-[#2A312D] group-hover:border-[#7C3AED] transition-colors"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#9CA6A0]">
                            <UserIcon className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <span className="truncate max-w-[200px] block font-bold text-[#F3F4F1] group-hover:text-[#A855F7] transition-colors">
                            {player.name}
                          </span>
                          {(player.age !== null || player.batting_hand) && (
                            <span className="text-[10px] text-[#9CA6A0] font-normal block">
                              {player.age !== null && `Age ${player.age}`}
                              {player.age !== null && player.batting_hand && ` • `}
                              {player.batting_hand && player.batting_hand}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#F3F4F1] font-medium">
                      {player.country || 'India'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2.5 py-1 rounded bg-[#0B0F0D] border border-[#2A312D] text-[10px] font-mono font-bold text-[#F3F4F1]">
                        {player.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-1 rounded text-[10px] font-mono font-black border ${
                          player.category === 'MARQUEE'
                            ? 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                            : player.category === 'A'
                            ? 'bg-purple-950/80 text-purple-300 border-purple-800/80'
                            : player.category === 'B'
                            ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/80'
                            : player.category === 'C'
                            ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                            : 'bg-[#0B0F0D] text-[#9CA6A0] border-[#2A312D]'
                        }`}
                      >
                        {categoryLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[#F3F4F1] font-extrabold text-sm">
                      {player.base_price} <span className="text-[10px] text-[#9CA6A0] font-sans font-normal">Lakhs</span>
                    </td>
                    <td className="px-4 py-3">
                      {player.is_overseas ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60 text-[10px] font-mono font-bold">
                          <Globe className="w-3 h-3" /> OVERSEAS
                        </span>
                      ) : (
                        <span className="text-[#9CA6A0] text-[10px] font-mono">DOMESTIC</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {onViewPlayer && (
                          <button
                            type="button"
                            onClick={() => onViewPlayer(player)}
                            className="px-2.5 py-1 rounded bg-[#7C3AED]/20 hover:bg-[#7C3AED]/40 text-[#A855F7] border border-[#7C3AED]/40 text-[10px] font-mono font-bold flex items-center gap-1 transition-colors"
                            title="View Player Card"
                          >
                            <Eye className="w-3 h-3" />
                            <span>VIEW</span>
                          </button>
                        )}
                        {isOwner && onEditPlayer && (
                          <button
                            type="button"
                            onClick={() => onEditPlayer(player)}
                            className="p-1.5 rounded-lg text-[#9CA6A0] hover:text-white hover:bg-[#0B0F0D] transition-colors"
                            title="Edit Player"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isOwner && onDeletePlayer && (
                          <button
                            type="button"
                            onClick={() => onDeletePlayer(player)}
                            className="p-1.5 rounded-lg text-[#9CA6A0] hover:text-red-400 hover:bg-red-950/30 transition-colors"
                            title="Delete Player"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
