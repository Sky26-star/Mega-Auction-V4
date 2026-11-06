'use client';

// src/components/player-sets/player-set-modal.tsx
// Player Set Create/Edit Modal for Mega Auction V2

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
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
    <Dialog.Root open={isOpen} onOpenChange={open => { if (!open && !isLoading) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content onEscapeKeyDown={e => { if (isLoading) e.preventDefault(); }} onPointerDownOutside={e => { if (isLoading) e.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[#39443B] bg-[#141917] text-[#F3F4F1] shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2A312D] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#C9A227]/10 text-[#E4B93F] border border-[#C9A227]/30 flex items-center justify-center shadow-inner">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <Dialog.Title className="text-xl font-semibold text-[#F3F4F1]">
                {initialData ? 'Edit Player Set' : 'Create Player Set'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[#9CA6A0]">Name your pool and choose who can use it.</Dialog.Description>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close player set dialog"
            onClick={onClose}
            disabled={isLoading}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-[#9CA6A0] hover:text-white hover:bg-[#242E27] transition-colors"
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
            <label htmlFor="set-name" className="block text-xs font-bold text-[#BBC3BD] uppercase tracking-wider mb-2">
              Player Set Name *
            </label>
            <input
              id="set-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. IPL 2026 Mega Auction Pool"
              disabled={isLoading}
              className="w-full min-h-12 px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#39443B] text-white placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] text-sm transition-all"
            />
            {fieldErrors.name && (
              <p className="mt-1.5 text-xs text-red-400">{fieldErrors.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="set-desc" className="block text-xs font-bold text-[#BBC3BD] uppercase tracking-wider mb-2">
              Description (Optional)
            </label>
            <textarea
              id="set-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief overview of marquee stars, international caps, or pool rules"
              disabled={isLoading}
              className="w-full min-h-12 px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#39443B] text-white placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] text-sm transition-all resize-none"
            />
            {fieldErrors.description && (
              <p className="mt-1.5 text-xs text-red-400">{fieldErrors.description}</p>
            )}
          </div>

          {/* Visibility Toggle */}
          <label
            className="p-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-between cursor-pointer hover:bg-[#0B0F0D] transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  isPublic
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-[#242E27] text-[#9CA6A0] border border-[#39443B]'
                }`}
              >
                {isPublic ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </div>
              <div>
                <span className="block text-xs font-bold text-white">Public Player Pool</span>
                <span className="block text-[11px] text-[#9CA6A0]">
                  Allow all auction room hosts to select this set
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={isLoading}
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-4 h-4 rounded border-[#39443B] bg-[#141917] accent-[#C9A227] focus:ring-[#C9A227] cursor-pointer"
            />
          </label>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-[#2A312D]">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="min-h-12 px-4 py-3 rounded-xl border border-[#39443B] text-[#BBC3BD] text-xs font-semibold hover:bg-[#242E27] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="min-h-12 px-5 py-3 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] text-xs font-semibold  flex items-center space-x-2 transition-colors disabled:opacity-50"
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
