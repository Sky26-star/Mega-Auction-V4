'use client';

// src/app/(dashboard)/rooms/page.tsx
// Redesigned Auction Rooms Hub with Host Edit + Delete Actions
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { RoomCard } from '@/components/rooms/room-card';
import { JoinRoomModal } from '@/components/rooms/join-room-modal';
import { AuctionStepper } from '@/components/ui/auction-stepper';
import { getRooms, updateRoom, deleteRoom } from '@/lib/rooms';
import { getCurrentProfile } from '@/lib/auth';
import type { Room } from '@/lib/types/room';
import type { Profile } from '@/lib/types/auth';
import {
  PlusCircle,
  LogIn,
  Key,
  Loader2,
  AlertCircle,
  Gavel,
  Shield,
  Edit,
  Trash2,
  X,
  CheckCircle,
  Clock,
  Coins,
  Users,
  Cpu,
} from 'lucide-react';

export default function RoomsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  // Edit Modal State
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editName, setEditName] = useState('');
  const [editPurse, setEditPurse] = useState(100);
  const [editTimer, setEditTimer] = useState(15);
  const [editSquad, setEditSquad] = useState(15);
  const [editBotCount, setEditBotCount] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Modal State
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [prof, userRooms] = await Promise.all([
        getCurrentProfile(),
        getRooms(),
      ]);
      setProfile(prof);
      setRooms(userRooms);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load rooms');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open Edit Modal
  const handleOpenEdit = (room: Room) => {
    setEditingRoom(room);
    setEditName(room.name);
    setEditPurse(room.settings?.default_purse ?? 100);
    setEditTimer(room.settings?.timer_duration_seconds ?? 15);
    setEditSquad(room.settings?.max_squad_size ?? 15);
    setEditBotCount(room.settings?.bot_count ?? 0);
    setEditError(null);
  };

  // Submit Edit Form
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom) return;
    setIsUpdating(true);
    setEditError(null);
    try {
      await updateRoom(editingRoom.id, {
        name: editName,
        default_purse: editPurse,
        timer_duration_seconds: editTimer,
        max_squad_size: editSquad,
        bot_count: editBotCount,
      });
      setEditingRoom(null);
      await loadData();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to update room settings.');
    } finally {
      setIsUpdating(false);
    }
  };

  // Submit Delete Action
  const handleConfirmDelete = async () => {
    if (!deletingRoom) return;
    const targetRoomId = deletingRoom.id;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteRoom(targetRoomId);
      setRooms((prev) => prev.filter((r) => r.id !== targetRoomId));
      setDeletingRoom(null);
      await loadData();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete room.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1] flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Main Broadcast Control Banner */}
        <div className="p-6 sm:p-8 rounded-2xl bg-[#141917] border-2 border-[#2A312D] shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
          <div className="space-y-2 z-10">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono-numbers font-extrabold text-[#C9A227] uppercase tracking-widest bg-[#0B0F0D] px-2.5 py-0.5 rounded border border-[#2A312D]">
                MEGA AUCTION ARENA
              </span>
              <span className="text-[10px] font-mono-numbers font-bold text-[#9CA6A0] uppercase tracking-wider">
                ROSTER HUB
              </span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-black text-[#F3F4F1] font-display uppercase tracking-wide flex items-center gap-3">
              <Gavel className="w-7 h-7 text-[#C9A227]" />
              <span>AUCTION ROOMS HUB</span>
            </h1>

            <p className="text-xs sm:text-sm text-[#9CA6A0] max-w-xl">
              Host live cricket auction control rooms or enter an existing lobby using a 6-character room code.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 z-10">
            <button
              onClick={() => setIsJoinModalOpen(true)}
              className="px-4 py-3 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] border-2 border-[#2A312D] hover:border-[#C9A227]/40 text-xs font-extrabold font-display uppercase tracking-wider transition-all flex items-center space-x-2 shadow-md"
            >
              <LogIn className="w-4 h-4 text-[#C9A227]" />
              <span>JOIN WITH CODE</span>
            </button>

            <Link
              href="/rooms/create"
              className="px-5 py-3 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] text-xs font-extrabold font-display uppercase tracking-wider shadow-lg flex items-center space-x-2 transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>CREATE NEW ROOM</span>
            </Link>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-[#B8322E]/10 border border-[#B8322E]/40 text-[#B8322E] text-xs font-mono-numbers flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Rooms Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-56 rounded-2xl bg-[#141917] border-2 border-[#2A312D] animate-pulse" />
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <div className="p-12 rounded-2xl bg-[#141917] border-2 border-[#2A312D] text-center text-[#9CA6A0] space-y-4">
            <Shield className="w-12 h-12 mx-auto text-[#2A312D]" />
            <div>
              <h3 className="text-base font-extrabold text-[#F3F4F1] font-display uppercase tracking-wide">
                NO ACTIVE ROOMS FOUND
              </h3>
              <p className="text-xs text-[#9CA6A0] mt-1 max-w-sm mx-auto">
                You have not created or joined any auction control rooms yet.
              </p>
            </div>
            
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={() => setIsJoinModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-[#0B0F0D] hover:bg-[#181E1A] text-[#F3F4F1] text-xs font-bold font-mono-numbers border border-[#2A312D] transition-colors"
              >
                JOIN ROOM CODE
              </button>
              <Link
                href="/rooms/create"
                className="px-4 py-2.5 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] text-xs font-bold font-display uppercase tracking-wider transition-colors"
              >
                CREATE FIRST ROOM
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                currentUserId={profile?.id}
                onEdit={handleOpenEdit}
                onDelete={(r) => {
                  setDeletingRoom(r);
                  setDeleteError(null);
                }}
              />
            ))}
          </div>
        )}
      </main>

      {/* Join Room Modal */}
      <JoinRoomModal isOpen={isJoinModalOpen} onClose={() => setIsJoinModalOpen(false)} />

      {/* -------------------------------------------------------------
          EDIT ROOM MODAL (Mega Auction Arena Styled)
         ------------------------------------------------------------- */}
      {editingRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#141917] border-2 border-[#2A312D] p-6 shadow-2xl relative space-y-5 animate-in fade-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#2A312D] pb-3">
              <div className="flex items-center space-x-2">
                <Edit className="w-5 h-5 text-[#C9A227]" />
                <h3 className="text-lg font-black text-[#F3F4F1] font-display uppercase tracking-wide">
                  EDIT ROOM SETTINGS
                </h3>
              </div>
              <button
                onClick={() => setEditingRoom(null)}
                className="p-1 rounded-lg text-[#9CA6A0] hover:text-[#F3F4F1] hover:bg-[#181E1A] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-xl bg-[#B8322E]/10 border border-[#B8322E]/40 text-[#B8322E] text-xs font-mono-numbers">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              {/* Room Name */}
              <div>
                <label className="block text-xs font-bold text-[#9CA6A0] uppercase tracking-wider mb-1.5">
                  ROOM NAME
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={50}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#0B0F0D] border border-[#2A312D] text-[#F3F4F1] text-sm font-bold focus:outline-none focus:border-[#C9A227]"
                />
              </div>

              {/* Steppers Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AuctionStepper
                  label="STARTING PURSE"
                  icon={<Coins className="w-3.5 h-3.5 text-[#E4B93F]" />}
                  value={editPurse}
                  min={100}
                  max={500}
                  step={10}
                  formatValue={(v) => `₹${v} Cr`}
                  formatDelta={(d) => (d > 0 ? `+₹${d} Cr` : `-₹${Math.abs(d)} Cr`)}
                  onChange={setEditPurse}
                />

                <AuctionStepper
                  label="TIMER PER LOT"
                  icon={<Clock className="w-3.5 h-3.5 text-[#B8322E]" />}
                  value={editTimer}
                  min={10}
                  max={60}
                  step={5}
                  formatValue={(v) => `${v} SEC`}
                  formatDelta={(d) => (d > 0 ? `+${d}s` : `-${Math.abs(d)}s`)}
                  onChange={setEditTimer}
                />

                <AuctionStepper
                  label="MAX SQUAD SIZE"
                  icon={<Users className="w-3.5 h-3.5 text-[#C9A227]" />}
                  value={editSquad}
                  min={15}
                  max={25}
                  step={5}
                  formatValue={(v) => `${v} PLAYERS`}
                  formatDelta={(d) => (d > 0 ? `+${d}` : `${d}`)}
                  onChange={setEditSquad}
                />

                <AuctionStepper
                  label="BOT OPPONENTS"
                  icon={<Cpu className="w-3.5 h-3.5 text-[#E4B93F]" />}
                  value={editBotCount}
                  min={0}
                  max={9}
                  step={1}
                  formatValue={(v) => (v === 0 ? '0 BOTS' : `${v} BOTS`)}
                  formatDelta={(d) => (d > 0 ? `+${d} BOT` : `-${Math.abs(d)} BOT`)}
                  onChange={setEditBotCount}
                />
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#2A312D]">
                <button
                  type="button"
                  onClick={() => setEditingRoom(null)}
                  className="px-4 py-2.5 rounded-xl bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#9CA6A0] text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  CANCEL
                </button>
                
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-5 py-2.5 rounded-xl bg-[#C9A227] hover:bg-[#E4B93F] text-[#0B0F0D] text-xs font-extrabold font-display uppercase tracking-wider transition-all flex items-center space-x-2"
                >
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  <span>SAVE CHANGES</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          DELETE ROOM CONFIRMATION MODAL (Mega Auction Arena Styled)
         ------------------------------------------------------------- */}
      {deletingRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#141917] border-2 border-[#B8322E]/40 p-6 shadow-2xl relative space-y-4 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="flex items-center space-x-3 text-[#B8322E]">
              <div className="w-10 h-10 rounded-xl bg-[#B8322E]/10 border border-[#B8322E]/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-[#B8322E]" />
              </div>
              <div>
                <h3 className="text-lg font-black font-display uppercase tracking-wide text-[#F3F4F1]">
                  DELETE AUCTION ROOM?
                </h3>
                <span className="text-xs font-mono-numbers text-[#9CA6A0]">
                  ROOM CODE: {deletingRoom.code}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#9CA6A0] bg-[#0B0F0D] p-3 rounded-xl border border-[#2A312D]">
              Room: <strong className="text-[#F3F4F1] font-bold">&quot;{deletingRoom.name}&quot;</strong>. This will permanently remove the room and all associated lobby data.
            </p>

            {deleteError && (
              <div className="p-3 rounded-xl bg-[#B8322E]/10 border border-[#B8322E]/40 text-[#B8322E] text-xs font-mono-numbers">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingRoom(null)}
                className="px-4 py-2.5 rounded-xl bg-[#181E1A] hover:bg-[#222A25] border border-[#2A312D] text-[#9CA6A0] text-xs font-bold uppercase tracking-wider transition-colors"
              >
                CANCEL
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-5 py-2.5 rounded-xl bg-[#B8322E] hover:bg-[#D32F2F] text-white text-xs font-extrabold font-display uppercase tracking-wider transition-all flex items-center space-x-2 shadow-lg"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>DELETE ROOM</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
