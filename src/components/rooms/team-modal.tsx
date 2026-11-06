'use client';

// src/components/rooms/team-modal.tsx
// Mega Auction V4 Franchise Identity Modal (Restyled to Match Dark Sports Lobby)

import React, { useState, useEffect } from 'react';
import type { Team, UpdateTeamInput } from '@/lib/types/room';
import { updateMyTeamSchema } from '@/lib/validations/room';
import { X, Trophy, Palette, Loader2, AlertCircle, Save, Sparkles } from 'lucide-react';

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: UpdateTeamInput) => Promise<void>;
  initialData?: Team | null;
}

const PRESET_COLORS = [
  '#2563EB', // Royal Blue (MI)
  '#EAB308', // Super Kings Yellow (CSK)
  '#DC2626', // Challengers Crimson (RCB)
  '#7C3AED', // Knight Riders Purple (KKR)
  '#EA580C', // Sunrisers Orange (SRH)
  '#059669', // Capitals Teal/Green (DC)
  '#0284C7', // Super Giants Cyan (LSG)
  '#DB2777', // Royals Pink (RR)
  '#C9A227', // Mega Gold Accent
  '#4F46E5', // Gujarat Indigo (GT)
];

export function TeamModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}: TeamModalProps) {
  const [teamName, setTeamName] = useState('');
  const [teamShortName, setTeamShortName] = useState('');
  const [teamColor, setTeamColor] = useState('#2563EB');

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialData && isOpen) {
      setTeamName(initialData.name || '');
      setTeamShortName(initialData.short_name || '');
      setTeamColor(initialData.color || '#2563EB');
      setError(null);
    } else if (isOpen) {
      setTeamName('');
      setTeamShortName('');
      setTeamColor('#2563EB');
      setError(null);
    }
  }, [initialData, isOpen]);

  // Keyboard accessibility: Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError(null);

    const validation = updateMyTeamSchema.safeParse({
      team_name: teamName.trim(),
      team_short_name: teamShortName.trim().toUpperCase(),
      team_color: teamColor.trim(),
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || 'Invalid franchise identity data.');
      return;
    }

    setIsLoading(true);
    try {
      await onSubmit(validation.data);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update franchise identity');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const previewName = teamName.trim() || 'Your Franchise Name';
  const previewShort = teamShortName.trim().toUpperCase() || 'TEAM';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans">
      <div
        className="absolute inset-0 bg-[#0B0F0D]/90 backdrop-blur-sm transition-opacity"
        onClick={() => !isLoading && onClose()}
      />

      <div className="relative w-full max-w-lg bg-[#141917] rounded-3xl border-2 border-[#2A312D] shadow-2xl overflow-hidden z-10 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#2A312D] sticky top-0 bg-[#141917] z-20">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F] shadow-inner">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-[#F3F4F1] uppercase font-display tracking-wider">
                EDIT FRANCHISE IDENTITY
              </h2>
              <p className="text-xs text-[#9CA6A0]">
                Update your franchise name, short code, and colors
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-2 rounded-lg text-[#9CA6A0] hover:text-[#F3F4F1] hover:bg-[#2A312D] transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div role="alert" className="p-3.5 rounded-xl bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-center space-x-3 text-[#F3F4F1] text-xs animate-shake">
              <AlertCircle className="w-4 h-4 text-[#B8322E] flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Live Franchise Card Preview */}
          <div className="p-4 rounded-2xl bg-[#0B0F0D] border border-[#2A312D] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#E4B93F]" />
                <span>LIVE FRANCHISE PREVIEW</span>
              </span>
              <span
                className="text-[10px] font-mono-numbers font-extrabold px-2 py-0.5 rounded border text-xs"
                style={{
                  backgroundColor: `${teamColor}20`,
                  borderColor: `${teamColor}60`,
                  color: teamColor,
                }}
              >
                ACTIVE
              </span>
            </div>

            <div className="flex items-center space-x-3 pt-1">
              {/* Short Code Badge */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-black text-sm text-white shadow-lg transition-colors border border-white/20"
                style={{ backgroundColor: teamColor }}
              >
                {previewShort}
              </div>

              {/* Franchise Info */}
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-black text-[#F3F4F1] font-display uppercase tracking-wide truncate">
                  {previewName}
                </h4>
                <p className="text-xs font-mono text-[#9CA6A0] flex items-center gap-2">
                  <span>CODE: <strong className="text-[#E4B93F]">{previewShort}</strong></span>
                  <span>•</span>
                  <span>HEX: <strong className="text-slate-300">{teamColor}</strong></span>
                </p>
              </div>
            </div>
          </div>

          {/* Inputs: Name & Short Code */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="franchise-name-input"
                className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2"
              >
                Franchise / Team Name
              </label>
              <input
                id="franchise-name-input"
                type="text"
                value={teamName}
                maxLength={30}
                disabled={isLoading}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Mumbai Indians"
                className="w-full px-4 py-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all text-xs sm:text-sm disabled:opacity-50"
                required
              />
            </div>

            <div>
              <label
                htmlFor="franchise-short-input"
                className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2"
              >
                Short Code
              </label>
              <input
                id="franchise-short-input"
                type="text"
                maxLength={5}
                disabled={isLoading}
                value={teamShortName}
                onChange={(e) => setTeamShortName(e.target.value.toUpperCase())}
                placeholder="MI"
                className="w-full px-4 py-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] font-mono text-xs sm:text-sm uppercase placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all disabled:opacity-50"
                required
              />
            </div>
          </div>

          {/* Franchise Color Selection */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="franchise-color-input"
                className="text-xs font-bold text-[#B4BDB7] uppercase tracking-wider flex items-center gap-1.5"
              >
                <Palette className="w-3.5 h-3.5 text-[#E4B93F]" />
                <span>Franchise Color Palette</span>
              </label>
              <span className="font-mono text-xs text-[#E4B93F] font-bold">{teamColor}</span>
            </div>

            <div className="flex items-center space-x-3 p-3 rounded-2xl bg-[#0B0F0D] border border-[#2A312D]">
              {/* Native Color Picker */}
              <input
                id="franchise-color-input"
                type="color"
                value={teamColor}
                disabled={isLoading}
                onChange={(e) => setTeamColor(e.target.value)}
                className="w-10 h-10 rounded-xl border border-[#2A312D] bg-[#141917] cursor-pointer p-0.5 focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                title="Custom Color Picker"
              />

              {/* Preset Swatches with Visible Active State */}
              <div className="flex items-center space-x-2 flex-1 overflow-x-auto py-1">
                {PRESET_COLORS.map((preset) => {
                  const isSelected = teamColor.toUpperCase() === preset.toUpperCase();
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={isLoading}
                      onClick={() => setTeamColor(preset)}
                      style={{ backgroundColor: preset }}
                      aria-label={`Select color ${preset}`}
                      className={`w-7 h-7 rounded-lg transition-all flex-shrink-0 relative ${
                        isSelected
                          ? 'scale-110 ring-2 ring-[#E4B93F] ring-offset-2 ring-offset-[#0B0F0D] shadow-md shadow-amber-500/30'
                          : 'opacity-80 hover:opacity-100 hover:scale-105'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-[#2A312D]">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={
                isLoading ||
                teamName.trim().length < 2 ||
                teamShortName.trim().length < 2
              }
              className="px-5 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] border border-[#7C3AED]/50 text-white shadow-lg shadow-purple-950/40 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 flex items-center space-x-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>SAVING...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>UPDATE FRANCHISE</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
