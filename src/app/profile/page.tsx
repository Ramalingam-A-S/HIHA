import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentUserProfile } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { logoutAction } from "@/app/actions/auth";

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4">
        <h1 className="text-xl font-bold text-[var(--foreground)]">
          Supabase Configuration Required
        </h1>
        <p className="text-sm text-[var(--foreground-secondary)]">
          Authentication requires Supabase environment variables. Please ensure
          NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are
          configured in your .env.local file.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const profile = await getCurrentUserProfile();

  // Graceful fallback if database trigger did not populate profile yet
  const activeProfile = profile ?? {
    id: user.id,
    username:
      (user.user_metadata?.username as string) ||
      `user_${user.id.slice(0, 8)}`,
    display_name:
      (user.user_metadata?.display_name as string) ||
      user.email?.split("@")[0] ||
      "User",
    bio: null,
    avatar_url: null,
    is_private: false,
    discoverable_in_search: true,
    follow_permission: "everyone" as const,
    interaction_permission: "everyone" as const,
    default_post_visibility: "public" as const,
    notify_on_follow_request: true,
    notify_on_new_follower: true,
    notify_on_follow_accepted: true,
    age_safety_mode: "standard" as const,
    minimum_age_attested_at: null,
    age_assurance_status: "self_attested" as const,
    privacy_policy_version: "v1.0-2026-10",
    deactivated_at: null,
    deletion_status: "active" as const,
    deletion_requested_at: null,
    created_at: user.created_at,
    updated_at: user.created_at,
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Profile Header Card */}
      <div className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Avatar Placeholder */}
            <div
              className="w-16 h-16 rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] flex items-center justify-center text-xl font-bold uppercase select-none"
              aria-hidden="true"
            >
              {activeProfile.display_name.charAt(0) || "U"}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
                  {activeProfile.display_name}
                </h1>
                {activeProfile.is_private && (
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]">
                    Private
                  </span>
                )}
                {activeProfile.age_safety_mode === "teen_13_17" && (
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                    Teen 13–17 Safety Active
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-[var(--foreground-muted)] mt-0.5">
                @{activeProfile.username}
              </p>
              <p className="text-xs text-[var(--foreground-secondary)] mt-1">
                {user.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="py-2 px-3.5 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] hover:opacity-90 transition-opacity"
            >
              Privacy &amp; Data Settings
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="py-2 px-3.5 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>

        {/* Account Metadata Summary */}
        <div className="pt-4 border-t border-[var(--border)] grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-[var(--foreground-muted)] block">
              Account Created
            </span>
            <span className="font-mono text-[var(--foreground)] mt-0.5 block">
              {new Date(activeProfile.created_at).toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="text-[var(--foreground-muted)] block">
              Account Status
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium mt-0.5 block">
              {activeProfile.deactivated_at
                ? "Deactivated (Scrubbed)"
                : "Active (Verified Session)"}
            </span>
          </div>
          <div>
            <span className="text-[var(--foreground-muted)] block">
              Safety Experience
            </span>
            <span className="font-mono text-[var(--foreground)] mt-0.5 block">
              {activeProfile.age_safety_mode === "teen_13_17"
                ? "Teen Protective (13–17)"
                : "Standard (18+)"}
            </span>
          </div>
        </div>
      </div>

      {/* Profile Edit Section */}
      <div className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
            Edit Profile Information
          </h2>
          <p className="text-xs text-[var(--foreground-muted)]">
            Update how you appear across communities and collaborative projects.
          </p>
        </div>

        <ProfileForm initialProfile={activeProfile} />
      </div>

      {/* Quick Link to Privacy, Age Safety & Personal Data Controls */}
      <div className="p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Privacy, Safety &amp; Personal Data Controls
          </h3>
          <p className="text-xs text-[var(--foreground-secondary)]">
            Manage follow permissions, content interactions, age-safety mode, blocked/muted accounts, JSON data export, and account deletion.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/policies"
            className="py-2 px-3 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
          >
            Policies
          </Link>
          <Link
            href="/settings"
            className="py-2 px-3.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90"
          >
            Open Settings →
          </Link>
        </div>
      </div>
    </div>
  );
}
