'use client';

// src/components/rooms/team-modal.tsx
// Phase 5B Identity-Only Team Edit Modal (Name, Short Code, Color)

import React, { useState, useEffect } from 'react';
import type { Team, UpdateTeamInput } from '@/lib/types/room';
import { updateMyTeamSchema } from '@/lib/validations/room';
import { X, Shield, Palette, Loader2, AlertCircle } from 'lucide-react';

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: UpdateTeamInput) => Promise<void>;
  initialData?: Team | null;
}

const PRESET_COLORS = [
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#6366F1', // Indigo
];

export function TeamModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}: TeamModalProps) {
  const [teamName, setTeamName] = useState('');
  const [teamShortName, setTeamShortName] = useState('');
  const [teamColor, setTeamColor] = useState('#3B82F6');

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setTeamName(initialData.name);
      setTeamShortName(initialData.short_name);
      setTeamColor(initialData.color);
    } else {
      setTeamName('');
      setTeamShortName('');
      setTeamColor('#3B82F6');
    }
    setError(null);
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validation = updateMyTeamSchema.safeParse({
      team_name: teamName,
      team_short_name: teamShortName,
      team_color: teamColor,
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || 'Invalid team identity data');
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
        setError('Failed to update team identity');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Edit Team Identity</h2>
              <p className="text-xs text-slate-400">Update your franchise name, short code, and color</p>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start space-x-3 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Team Name & Short Name */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Franchise / Team Name
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Mumbai Indians"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Short Code
              </label>
              <input
                type="text"
                maxLength={5}
                value={teamShortName}
                onChange={(e) => setTeamShortName(e.target.value.toUpperCase())}
                placeholder="MI"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs uppercase placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                required
              />
            </div>
          </div>

          {/* Franchise Color */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-indigo-400" /> Franchise Color
              </span>
              <span className="font-mono text-slate-400">{teamColor}</span>
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={teamColor}
                onChange={(e) => setTeamColor(e.target.value)}
                className="w-10 h-10 rounded-xl border border-slate-700 bg-slate-950 cursor-pointer p-0.5"
              />
              <div className="flex items-center space-x-1.5 flex-1 overflow-x-auto">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTeamColor(preset)}
                    style={{ backgroundColor: preset }}
                    className={`w-7 h-7 rounded-lg transition-transform ${
                      teamColor.toUpperCase() === preset ? 'scale-110 ring-2 ring-white' : 'opacity-80 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 flex items-center space-x-2 transition-all"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Update Team Identity</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

