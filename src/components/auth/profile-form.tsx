'use client';

// src/components/auth/profile-form.tsx
import React, { useState } from 'react';
import { updateCurrentProfile } from '@/lib/auth';
import { profileSchema } from '@/lib/validations/auth';
import type { Profile } from '@/lib/types/auth';
import { User, Image as ImageIcon, CheckCircle2, AlertCircle, Loader2, ShieldCheck, AtSign, RotateCcw, Save } from 'lucide-react';

interface ProfileFormProps {
  initialProfile: Profile;
  isAdmin: boolean;
}

export function ProfileForm({ initialProfile, isAdmin }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(initialProfile.display_name || '');
  const [avatarUrl, setAvatarUrl] = useState(initialProfile.avatar_url || '');

  const [saved, setSaved] = useState({ displayName: initialProfile.display_name || '', avatarUrl: initialProfile.avatar_url || '' });
  const [previewUrl, setPreviewUrl] = useState(initialProfile.avatar_url || '');
  const [imageFailed, setImageFailed] = useState(false);
  const isDirty = displayName !== saved.displayName || avatarUrl !== saved.avatarUrl;

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

      setSaved({ displayName, avatarUrl });
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

  const resetChanges = () => {
    setDisplayName(saved.displayName); setAvatarUrl(saved.avatarUrl);
    setPreviewUrl(saved.avatarUrl); setImageFailed(false);
    setError(null); setSuccess(null); setFieldErrors({});
  };
  const inputClass = 'w-full min-h-12 rounded-lg border border-[#39443B] bg-[#0B0F0D] py-3 pl-10 pr-4 text-sm text-[#F3F4F1] transition-colors focus:outline-none focus:ring-2 focus:ring-[#C9A227] disabled:opacity-50';
  const labelClass = 'mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[#BBC3BD]';

  return (
    <div className="grid min-w-0 items-start gap-5 md:grid-cols-[260px_minmax(0,1fr)] lg:gap-7">
      <aside className="min-w-0 overflow-hidden rounded-xl border border-[#39443B] bg-[#141917]">
        <div className="h-1 bg-[#C9A227]" />
        <div className="p-6">
          <p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9CA6A0]">Profile preview</p>
          <div className="mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-[#C9A227]/40 bg-[#C9A227]/10 text-3xl font-bold text-[#E4B93F]">
            {previewUrl && !imageFailed ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={previewUrl} alt="Your avatar preview" className="h-full w-full object-cover" onError={() => setImageFailed(true)} referrerPolicy="no-referrer" />
            ) : (displayName.trim() || initialProfile.username).slice(0, 2).toUpperCase()}
          </div>
          <h2 className="break-words text-2xl font-semibold">{displayName.trim() || initialProfile.username}</h2>
          <p className="mt-1 break-all text-sm text-[#9CA6A0]">@{initialProfile.username}</p>
          {isAdmin && <span className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[#C9A227]/30 bg-[#C9A227]/10 px-2.5 py-1 text-xs text-[#E4B93F]"><ShieldCheck className="h-3.5 w-3.5" /> Admin</span>}
          <p className="mt-6 border-t border-[#2A312D] pt-4 text-xs leading-relaxed text-[#9CA6A0]">This is how other managers see you in the auction.</p>
        </div>
      </aside>
      <section aria-labelledby="profile-details-title" className="min-w-0 rounded-xl border border-[#2A312D] bg-[#141917] p-5 sm:p-7">
        <div className="mb-6 border-b border-[#2A312D] pb-5">
          <h2 id="profile-details-title" className="text-xl font-semibold">Public profile</h2>
          <p className="mt-1 text-sm text-[#9CA6A0]">Update your name and avatar in one place.</p>
        </div>
        {error && <div role="alert" className="mb-5 flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><AlertCircle className="h-5 w-5 shrink-0" /><span>{error}</span></div>}
        {success && <div role="status" className="mb-5 flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300"><CheckCircle2 className="h-5 w-5 shrink-0" /><span>{success}</span></div>}
        <form onSubmit={handleSubmit} className="space-y-5" id="profile-form">
          <div>
            <label htmlFor="profile-username" className={labelClass}>Username <span className="ml-1 text-[#9CA6A0]">· Permanent</span></label>
            <div className="relative"><AtSign className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA6A0]" /><input id="profile-username" type="text" value={initialProfile.username} readOnly aria-describedby="username-help" className={inputClass + ' text-[#9CA6A0]'} /></div>
            <p id="username-help" className="mt-2 text-xs text-[#9CA6A0]">Your unique username stays the same.</p>
          </div>
          <div>
            <label htmlFor="profile-displayname" className={labelClass}>Display name</label>
            <div className="relative"><User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA6A0]" /><input id="profile-displayname" type="text" autoComplete="nickname" value={displayName} onChange={e => { setDisplayName(e.target.value); setSuccess(null); }} placeholder="Your public name" disabled={isLoading} aria-invalid={!!fieldErrors.displayName} aria-describedby={fieldErrors.displayName ? 'displayname-error' : undefined} className={inputClass} /></div>
            {fieldErrors.displayName && <p id="displayname-error" role="alert" className="mt-2 text-xs text-red-300">{fieldErrors.displayName}</p>}
          </div>
          <div>
            <label htmlFor="profile-avatarurl" className={labelClass}>Avatar URL <span className="ml-1 text-[#9CA6A0]">· Optional</span></label>
            <div className="relative"><ImageIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA6A0]" /><input id="profile-avatarurl" type="url" value={avatarUrl} onChange={e => { setAvatarUrl(e.target.value); setSuccess(null); }} onBlur={() => { setPreviewUrl(avatarUrl); setImageFailed(false); }} placeholder="https://example.com/avatar.jpg" disabled={isLoading} aria-invalid={!!fieldErrors.avatarUrl} aria-describedby={fieldErrors.avatarUrl ? 'avatar-error' : 'avatar-help'} className={inputClass} /></div>
            {fieldErrors.avatarUrl ? <p id="avatar-error" role="alert" className="mt-2 text-xs text-red-300">{fieldErrors.avatarUrl}</p> : <p id="avatar-help" className="mt-2 text-xs leading-relaxed text-[#9CA6A0]">Paste an image link, or leave empty to use your initials.</p>}
          </div>
          <div className="flex flex-col gap-3 border-t border-[#2A312D] pt-5 sm:flex-row-reverse">
            <button id="profile-submit-btn" type="submit" disabled={isLoading || !isDirty} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#C9A227] px-5 text-sm font-bold text-[#0B0F0D] transition-colors hover:bg-[#E4B93F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E4B93F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#141917] disabled:cursor-not-allowed disabled:opacity-40">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {isLoading ? 'Saving changes…' : 'Save changes'}
            </button>
            <button type="button" onClick={resetChanges} disabled={isLoading || !isDirty} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#39443B] px-4 text-sm font-semibold text-[#BBC3BD] hover:bg-[#242E27] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Reset changes</button>
          </div>
        </form>
      </section>
    </div>
  );
}
