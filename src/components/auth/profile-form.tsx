'use client';

// src/components/auth/profile-form.tsx
import React, { useState } from 'react';
import { updateCurrentProfile } from '@/lib/auth';
import { profileSchema } from '@/lib/validations/auth';
import type { Profile } from '@/lib/types/auth';
import { User, Image as ImageIcon, CheckCircle2, AlertCircle, Loader2, ShieldCheck, AtSign } from 'lucide-react';

interface ProfileFormProps {
  initialProfile: Profile;
}

export function ProfileForm({ initialProfile }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(initialProfile.display_name || '');
  const [avatarUrl, setAvatarUrl] = useState(initialProfile.avatar_url || '');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ displayName?: string; avatarUrl?: string }>({});
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setFieldErrors({});

    const validation = profileSchema.safeParse({ displayName, avatarUrl });
    if (!validation.success) {
      const formatted = validation.error.format();
      setFieldErrors({
        displayName: formatted.displayName?._errors[0],
        avatarUrl: formatted.avatarUrl?._errors[0],
      });
      return;
    }

    setIsLoading(true);
    try {
      await updateCurrentProfile({
        displayName,
        avatarUrl: avatarUrl || null,
      });

      setSuccess('Profile updated successfully!');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update profile. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-2xl backdrop-blur-xl transition-all">
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-400" />
            Profile Settings
          </h2>
          <p className="text-xs text-slate-400 mt-1">Manage your account information and public appearance</p>
        </div>

        {initialProfile.is_admin && (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            Admin
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start space-x-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start space-x-3 text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6" id="profile-form">
        {/* Read-Only Username */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Username (Permanent)
          </label>
          <div className="relative">
            <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={initialProfile.username}
              disabled
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400 cursor-not-allowed text-sm font-mono"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Usernames are unique identifiers and cannot be changed.</p>
        </div>

        {/* Display Name */}
        <div>
          <label htmlFor="profile-displayname" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Display Name
          </label>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              id="profile-displayname"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your public name"
              disabled={isLoading}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50 text-sm"
            />
          </div>
          {fieldErrors.displayName && (
            <p className="mt-1.5 text-xs text-red-400">{fieldErrors.displayName}</p>
          )}
        </div>

        {/* Avatar URL */}
        <div>
          <label htmlFor="profile-avatarurl" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Avatar URL (Optional)
          </label>
          <div className="relative">
            <ImageIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              id="profile-avatarurl"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.jpg"
              disabled={isLoading}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50 text-sm"
            />
          </div>
          {fieldErrors.avatarUrl && (
            <p className="mt-1.5 text-xs text-red-400">{fieldErrors.avatarUrl}</p>
          )}
        </div>

        <button
          id="profile-submit-btn"
          type="submit"
          disabled={isLoading}
          className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/30 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center space-x-2 text-sm"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span>Saving Changes...</span>
            </>
          ) : (
            <span>Save Profile Changes</span>
          )}
        </button>
      </form>
    </div>
  );
}
