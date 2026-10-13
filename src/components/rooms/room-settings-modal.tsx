'use client';

import React, { useState, useEffect } from 'react';
import { Settings, X, Loader2, AlertCircle, Save, Coins, Clock, Users, Cpu } from 'lucide-react';
import { AuctionStepper } from '@/components/ui/auction-stepper';
import type { Room } from '@/lib/types/room';

export interface RoomSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    default_purse: number;
    timer_duration_seconds: number;
    max_squad_size: number;
    bot_count?: number;
  }) => Promise<void>;
  initialData: Room | null;
}

export function RoomSettingsModal({ isOpen, onClose, onSubmit, initialData }: RoomSettingsModalProps) {
  const [name, setName] = useState('');
  const [defaultPurse, setDefaultPurse] = useState(100);
  const [timerDuration, setTimerDuration] = useState(10);
  const [maxSquadSize, setMaxSquadSize] = useState(15);
  const [enableBots, setEnableBots] = useState(true);
  const [botCount, setBotCount] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  useEffect(() => {
    if (isOpen && initialData) {
      setName(initialData.name);
      setDefaultPurse(initialData.settings?.default_purse || 100);
      setTimerDuration(initialData.settings?.timer_duration_seconds || 10);
      setMaxSquadSize(initialData.settings?.max_squad_size || 15);
      const initialBotCount = initialData.settings?.bot_count || 0;
      setBotCount(initialBotCount);
      setEnableBots(initialBotCount > 0);
      setError(null);
      setShowUnsavedWarning(false);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const hasUnsavedChanges = () => {
    if (!initialData) return false;
    const initialBotCount = initialData.settings?.bot_count || 0;
    const activeBotCount = enableBots ? botCount : 0;
    return (
      name !== initialData.name ||
      defaultPurse !== (initialData.settings?.default_purse || 100) ||
      timerDuration !== (initialData.settings?.timer_duration_seconds || 10) ||
      maxSquadSize !== (initialData.settings?.max_squad_size || 15) ||
      activeBotCount !== initialBotCount
    );
  };

  const handleClose = () => {
    if (hasUnsavedChanges()) {
      setShowUnsavedWarning(true);
    } else {
      onClose();
    }
  };

  const handleDiscard = () => {
    setShowUnsavedWarning(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 3) {
      setError('Room name must be at least 3 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const activeBotCount = enableBots ? botCount : 0;

    try {
      await onSubmit({
        name,
        default_purse: defaultPurse,
        timer_duration_seconds: timerDuration,
        max_squad_size: maxSquadSize,
        bot_count: activeBotCount,
      });
      setShowUnsavedWarning(false); // Reset unsaved warning safely
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0B0F0D]/90 backdrop-blur-sm" onClick={handleClose} />

      {showUnsavedWarning ? (
        <div className="relative w-full max-w-sm bg-[#141917] rounded-3xl border border-[#C9A227]/40 shadow-2xl p-6 z-10 flex flex-col space-y-4">
          <div className="flex items-center space-x-3 text-[#E4B93F]">
            <AlertCircle className="w-6 h-6" />
            <h3 className="text-base font-black uppercase font-display tracking-wider">UNSAVED CHANGES</h3>
          </div>
          <p className="text-sm text-[#9CA6A0]">
            You have unsaved room settings. Discard your changes?
          </p>
          <div className="flex items-center space-x-3 pt-2">
            <button
              onClick={() => setShowUnsavedWarning(false)}
              className="flex-1 py-2 px-4 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] font-bold text-xs uppercase tracking-wider transition-all hover:bg-[#181E1A]"
            >
              CANCEL
            </button>
            <button
              onClick={handleDiscard}
              className="flex-1 py-2 px-4 rounded-xl bg-[#B8322E]/20 hover:bg-[#B8322E]/40 border border-[#B8322E]/60 text-[#B8322E] font-bold text-xs uppercase tracking-wider transition-all"
            >
              DISCARD
            </button>
          </div>
        </div>
      ) : (
        <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#141917] rounded-3xl shadow-2xl border-2 border-[#2A312D] z-10">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[#2A312D] sticky top-0 bg-[#141917] z-20">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-[#0B0F0D] border border-[#2A312D] flex items-center justify-center text-[#E4B93F]">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-[#F3F4F1] uppercase font-display tracking-wider">ROOM SETTINGS</h2>
                <p className="text-xs text-[#9CA6A0]">Edit auction configuration before starting</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="p-2 rounded-lg text-[#9CA6A0] hover:text-[#F3F4F1] hover:bg-[#2A312D] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="p-3 rounded-xl bg-[#8F2724]/20 border border-[#B8322E]/60 flex items-center space-x-3 text-[#F3F4F1] text-xs">
                <AlertCircle className="w-4 h-4 text-[#B8322E] flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Room Name */}
            <div>
              <label htmlFor="edit-room-name" className="block text-xs font-bold text-[#B4BDB7] uppercase tracking-wider mb-2">
                Room Name
              </label>
              <input
                id="edit-room-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] placeholder-[#9CA6A0] focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent transition-all text-sm"
                required
              />
            </div>

            {/* Auction Settings Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <AuctionStepper
                id="edit-purse-stepper"
                label="STARTING PURSE (CRORES)"
                icon={<Coins className="w-3.5 h-3.5 text-[#E4B93F]" />}
                value={defaultPurse}
                min={100}
                max={150}
                step={10}
                formatValue={(v) => `₹${v} Cr`}
                formatDelta={(d) => (d > 0 ? `+₹${d} Cr` : `-₹${Math.abs(d)} Cr`)}
                onChange={setDefaultPurse}
              />

              <AuctionStepper
                id="edit-timer-stepper"
                label="TIMER PER LOT"
                icon={<Clock className="w-3.5 h-3.5 text-[#B8322E]" />}
                value={timerDuration}
                min={10}
                max={20}
                step={5}
                formatValue={(v) => `${v} SEC`}
                formatDelta={(d) => (d > 0 ? `+${d} SEC` : `-${Math.abs(d)} SEC`)}
                onChange={setTimerDuration}
              />

              <AuctionStepper
                id="edit-squad-stepper"
                label="MAX SQUAD SIZE"
                icon={<Users className="w-3.5 h-3.5 text-[#C9A227]" />}
                value={maxSquadSize}
                min={15}
                max={25}
                step={5}
                formatValue={(v) => `${v} PLAYERS`}
                formatDelta={(d) => (d > 0 ? `+${d} PLAYERS` : `-${Math.abs(d)} PLAYERS`)}
                onChange={setMaxSquadSize}
              />
            </div>

            {/* Bots Section */}
            <div className="p-5 rounded-2xl bg-[#0B0F0D] border border-[#2A312D] space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Cpu className="w-4 h-4 text-[#E4B93F]" />
                  <span className="text-xs font-bold text-[#F3F4F1] uppercase tracking-wider">BOT OPPONENTS</span>
                </div>
                <label htmlFor="edit-enable-bots" className="flex items-center space-x-2 cursor-pointer">
                  <input
                    id="edit-enable-bots"
                    type="checkbox"
                    checked={enableBots}
                    onChange={(e) => setEnableBots(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#141917] peer-focus:outline-none rounded-full peer border border-[#2A312D] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#9CA6A0] peer-checked:after:bg-[#E4B93F] after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2A312D] relative" />
                </label>
              </div>

              {enableBots && (
                <div className="pt-2">
                  <AuctionStepper
                    id="edit-bots-stepper"
                    label="BOT OPPONENTS"
                    subtext="AI MANAGERS"
                    icon={<Cpu className="w-3.5 h-3.5 text-[#E4B93F]" />}
                    value={botCount}
                    min={0}
                    max={9}
                    step={1}
                    formatValue={(v) => (v === 0 ? '0 BOTS (DISABLED)' : `${v} AI MANAGERS`)}
                    formatDelta={(d) => (d > 0 ? `+${d} BOT` : `-${Math.abs(d)} BOT`)}
                    onChange={setBotCount}
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end space-x-3 pt-4 border-t border-[#2A312D]">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] border border-[#2A312D] text-[#F3F4F1] text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={isSubmitting || name.trim().length < 3}
                className="px-5 py-2.5 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] border border-[#7C3AED]/50 text-white shadow-lg shadow-purple-950/40 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 flex items-center space-x-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>SAVING...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>SAVE SETTINGS</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
