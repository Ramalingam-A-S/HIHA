import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getPrivacyAndSafetyOverviewAction } from "@/app/actions/privacy";
import { PrivacySettingsView } from "@/components/privacy/PrivacySettingsView";

export const metadata = {
  title: "Privacy, Age Safety & Personal Data Controls | HIHA",
  description:
    "Review and manage your account visibility, follow and interaction permissions, age-safety mode, blocked and muted accounts, personal data export, and account deletion.",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/settings");
  }

  const overviewResult = await getPrivacyAndSafetyOverviewAction();
  if (!overviewResult.success || !overviewResult.data) {
    return (
      <div className="max-w-3xl mx-auto p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4">
        <h1 className="text-xl font-bold text-[var(--foreground)]">
          Privacy &amp; Safety Settings Unavailable
        </h1>
        <p className="text-xs text-[var(--foreground-secondary)]">
          {overviewResult.message ||
            "Unable to load your privacy and safety settings at this time."}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      {/* Editorial Header */}
      <div className="border-b border-[var(--border)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-mono rounded-full bg-[var(--surface-muted)] text-[var(--accent)] border border-[var(--border-subtle)]">
            <span>User Autonomy</span>
            <span>•</span>
            <span>Age-Aware Safety</span>
            <span>•</span>
            <span>Data Rights</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
            Privacy, Safety &amp; Personal Data Controls
          </h1>
          <p className="text-sm text-[var(--foreground-secondary)] max-w-2xl leading-relaxed">
            Control your profile discoverability, who can follow or interact with your content, age-appropriate protective boundaries, blocked and muted accounts, machine-readable JSON data exports, and account deletion.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/policies"
            className="py-2 px-3.5 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            Platform Policies (v1.4)
          </Link>
          <Link
            href="/profile"
            className="py-2 px-3.5 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)] transition-colors"
          >
            ← Back to Profile
          </Link>
        </div>
      </div>

      <PrivacySettingsView initialOverview={overviewResult.data} />
    </div>
  );
}
