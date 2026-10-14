"use client";

import React, { useState, useTransition } from "react";
import { updateProfileAction } from "@/app/actions/profile";
import type { Profile } from "@/lib/supabase/types";

interface ProfileFormProps {
  initialProfile: Profile;
}

export function ProfileForm({ initialProfile }: ProfileFormProps) {
  const [isPending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(initialProfile.display_name);
  const [bio, setBio] = useState(initialProfile.bio ?? "");
  const [isPrivate, setIsPrivate] = useState(initialProfile.is_private);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await updateProfileAction({
        displayName,
        bio: bio.trim() || null,
        isPrivate,
      });

      if (!result.success) {
        setStatusMessage({
          type: "error",
          text: result.message || "Failed to update profile",
        });
        if (result.errors) {
          setFieldErrors(result.errors);
        }
      } else {
        setStatusMessage({
          type: "success",
          text: result.message || "Profile updated successfully.",
        });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {statusMessage && (
        <div
          role="status"
          className={`p-3 text-xs rounded-[var(--radius-sm)] border ${
            statusMessage.type === "success"
              ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
              : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Username (Protected / Read-Only in this milestone) */}
      <div className="space-y-1.5">
        <label
          htmlFor="profile-username"
          className="block text-xs font-medium text-[var(--foreground)]"
        >
          Username (Identifier)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-2 text-sm text-[var(--foreground-muted)]">
            @
          </span>
          <input
            id="profile-username"
            type="text"
            disabled
            value={initialProfile.username}
            className="w-full pl-7 pr-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-muted)] cursor-not-allowed"
          />
        </div>
        <p className="text-[11px] text-[var(--foreground-muted)]">
          Usernames are permanent identifiers established at registration.
        </p>
      </div>

      {/* Display Name */}
      <div className="space-y-1.5">
        <label
          htmlFor="profile-display-name"
          className="block text-xs font-medium text-[var(--foreground)]"
        >
          Display Name
        </label>
        <input
          id="profile-display-name"
          type="text"
          required
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
        />
        {fieldErrors.displayName && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            {fieldErrors.displayName[0]}
          </p>
        )}
      </div>

      {/* Biography */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="profile-bio"
            className="block text-xs font-medium text-[var(--foreground)]"
          >
            Biography
          </label>
          <span className="text-[11px] font-mono text-[var(--foreground-muted)]">
            {bio.length}/500
          </span>
        </div>
        <textarea
          id="profile-bio"
          rows={4}
          maxLength={500}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Share your interests, learning focuses, or creative projects..."
          className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)] resize-y"
        />
        {fieldErrors.bio && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            {fieldErrors.bio[0]}
          </p>
        )}
      </div>

      {/* Privacy Setting */}
      <div className="pt-4 border-t border-[var(--border)] space-y-3">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--foreground)]">
            Audience & Privacy
          </h3>
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
            Control whether your activity is publicly discoverable or restricted to your account.
          </p>
        </div>

        <label className="flex items-start gap-3 p-3.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] cursor-pointer hover:bg-[var(--surface-muted)] transition-colors">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--focus-ring)]"
          />
          <div className="space-y-0.5">
            <span className="text-sm font-medium text-[var(--foreground)] block">
              Private Profile
            </span>
            <span className="text-xs text-[var(--foreground-muted)] block leading-relaxed">
              When enabled, your profile and content are hidden from the global Explore feed and anonymous visitors.
            </span>
          </div>
        </label>
      </div>

      <div className="pt-2 flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="py-2 px-5 text-sm font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending ? "Saving changes..." : "Save Profile"}
        </button>
      </div>
    </form>
  );
}
