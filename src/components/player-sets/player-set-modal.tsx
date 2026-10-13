'use client';

// src/components/player-sets/player-set-modal.tsx
// Player Set Create/Edit Modal for Mega Auction V2

import React, { useState, useEffect } from 'react';
import type { PlayerSet, PlayerSetFormInput } from '@/lib/types/player-set';
import { playerSetSchema } from '@/lib/validations/player-set';
import { X, Database, Globe, Lock, Loader2, AlertCircle } from 'lucide-react';

interface PlayerSetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: PlayerSetFormInput) => Promise<void>;
  initialData?: PlayerSet | null;
}

export function PlayerSetModal({ isOpen, onClose, onSubmit, initialData }: PlayerSetModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; description?: string }>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '');
      setDescription(initialData.description || '');
      setIsPublic(initialData.is_public || false);
    } else {
      setName('');
      setDescription('');
      setIsPublic(false);
    }
    setError(null);
    setFieldErrors({});
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const validation = playerSetSchema.safeParse({
      name,
      description,
      is_public: isPublic,
    });

    if (!validation.success) {
      const formatted = validation.error.format();
      setFieldErrors({
        name: formatted.name?._errors[0],
        description: formatted.description?._errors[0],
      });
      return;
    }

    setIsLoading(true);
    try {
      await onSubmit({
        name,
        description: description || null,
        is_public: isPublic,
      });
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to save player set');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30 flex items-center justify-center shadow-inner">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {initialData ? 'Edit Player Set' : 'Create Player Set'}
              </h2>
              <p className="text-xs text-slate-400">Configure custom auction player pool database</p>
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

          <div>
            <label htmlFor="set-name" className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Player Set Name *
            </label>
            <input
              id="set-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. IPL 2026 Mega Auction Pool"
              disabled={isLoading}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-xs transition-all"
            />
            {fieldErrors.name && (
              <p className="mt-1.5 text-xs text-red-400">{fieldErrors.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="set-desc" className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Description (Optional)
            </label>
            <textarea
              id="set-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief overview of marquee stars, international caps, or pool rules"
              disabled={isLoading}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-xs transition-all resize-none"
            />
            {fieldErrors.description && (
              <p className="mt-1.5 text-xs text-red-400">{fieldErrors.description}</p>
            )}
          </div>

          {/* Visibility Toggle */}
          <div
            className="p-4 rounded-2xl bg-slate-800/40 border border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition-colors"
            onClick={() => setIsPublic(!isPublic)}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  isPublic
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {isPublic ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </div>
              <div>
                <span className="block text-xs font-bold text-white">Public Player Pool</span>
                <span className="block text-[11px] text-slate-400">
                  Allow all auction room hosts to select this set
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-violet-500 cursor-pointer"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
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
              className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/30 flex items-center space-x-2 transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>{initialData ? 'Update Set' : 'Create Set'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
