"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  updatePrivacyAndSafetySettingsAction,
  exportPersonalDataAction,
  deleteOrDeactivateAccountAction,
  reactivateAccountAction,
  type PrivacyAndSafetyOverview,
} from "@/app/actions/privacy";
import { unblockUserAction, unmuteUserAction } from "@/app/actions/relationships";
import {
  applyTeenSafetyModeDefaults,
  type FollowPermission,
  type InteractionPermission,
  type DefaultPostVisibility,
  type AgeSafetyMode,
  type AccountDeletionMode,
  type PersonalDataExportPackage,
} from "@/lib/privacy/types";

interface PrivacySettingsViewProps {
  initialOverview: PrivacyAndSafetyOverview;
}

export function PrivacySettingsView({
  initialOverview,
}: PrivacySettingsViewProps) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const { profile } = overview;

  // Privacy & Safety Settings form state
  const [isPrivate, setIsPrivate] = useState(profile.is_private);
  const [discoverableInSearch, setDiscoverableInSearch] = useState(
    profile.discoverable_in_search
  );
  const [followPermission, setFollowPermission] = useState<FollowPermission>(
    profile.follow_permission
  );
  const [interactionPermission, setInteractionPermission] =
    useState<InteractionPermission>(profile.interaction_permission);
  const [defaultPostVisibility, setDefaultPostVisibility] =
    useState<DefaultPostVisibility>(profile.default_post_visibility);
  const [ageSafetyMode, setAgeSafetyMode] = useState<AgeSafetyMode>(
    profile.age_safety_mode
  );
  const [notifyOnFollowRequest, setNotifyOnFollowRequest] = useState(
    profile.notify_on_follow_request
  );
  const [notifyOnNewFollower, setNotifyOnNewFollower] = useState(
    profile.notify_on_new_follower
  );
  const [notifyOnFollowAccepted, setNotifyOnFollowAccepted] = useState(
    profile.notify_on_follow_accepted
  );

  const [isSavingSettings, startSavingSettings] = useTransition();
  const [settingsFeedback, setSettingsFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Blocked & Muted state
  const [isRelationshipPending, startRelationshipTransition] = useTransition();
  const [relationshipFeedback, setRelationshipFeedback] = useState<string | null>(
    null
  );

  // Data Export state
  const [isExporting, startExportTransition] = useTransition();
  const [exportedPackage, setExportedPackage] =
    useState<PersonalDataExportPackage | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Account Deletion / Deactivation state
  const [deletionMode, setDeletionMode] = useState<AccountDeletionMode>(
    "deactivate_and_scrub"
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [isDeleting, startDeletionTransition] = useTransition();
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deletionSuccess, setDeletionSuccess] = useState<string | null>(null);

  const isTeenMode = ageSafetyMode === "teen_13_17";

  const handleAgeModeChange = (nextMode: AgeSafetyMode) => {
    setAgeSafetyMode(nextMode);
    if (nextMode === "teen_13_17") {
      const normalized = applyTeenSafetyModeDefaults({
        isPrivate,
        discoverableInSearch,
        followPermission,
        interactionPermission,
        defaultPostVisibility,
        notifyOnFollowRequest,
        notifyOnNewFollower,
        notifyOnFollowAccepted,
        ageSafetyMode: "teen_13_17",
      });
      setIsPrivate(normalized.isPrivate);
      setDiscoverableInSearch(normalized.discoverableInSearch);
      setFollowPermission(normalized.followPermission);
      setInteractionPermission(normalized.interactionPermission);
      setDefaultPostVisibility(normalized.defaultPostVisibility);
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsFeedback(null);

    startSavingSettings(async () => {
      const res = await updatePrivacyAndSafetySettingsAction({
        isPrivate,
        discoverableInSearch,
        followPermission,
        interactionPermission,
        defaultPostVisibility,
        ageSafetyMode,
        notifyOnFollowRequest,
        notifyOnNewFollower,
        notifyOnFollowAccepted,
      });

      if (!res.success || !res.data) {
        setSettingsFeedback({
          type: "error",
          text: res.message || "Failed to save privacy settings.",
        });
      } else {
        setOverview((prev) => ({ ...prev, profile: res.data! }));
        setIsPrivate(res.data.is_private);
        setDiscoverableInSearch(res.data.discoverable_in_search);
        setFollowPermission(res.data.follow_permission);
        setInteractionPermission(res.data.interaction_permission);
        setDefaultPostVisibility(res.data.default_post_visibility);
        setAgeSafetyMode(res.data.age_safety_mode);
        setSettingsFeedback({
          type: "success",
          text: res.message || "Privacy & safety settings updated.",
        });
        router.refresh();
      }
    });
  };

  const handleUnblock = (blockedId: string) => {
    setRelationshipFeedback(null);
    startRelationshipTransition(async () => {
      const res = await unblockUserAction(blockedId);
      if (res.success) {
        setOverview((prev) => ({
          ...prev,
          blockedAccounts: prev.blockedAccounts.filter(
            (b) => b.blocked_id !== blockedId
          ),
        }));
        setRelationshipFeedback("Account unblocked.");
        router.refresh();
      } else {
        setRelationshipFeedback(res.message || "Failed to unblock account.");
      }
    });
  };

  const handleUnmute = (mutedId: string) => {
    setRelationshipFeedback(null);
    startRelationshipTransition(async () => {
      const res = await unmuteUserAction(mutedId);
      if (res.success) {
        setOverview((prev) => ({
          ...prev,
          mutedAccounts: prev.mutedAccounts.filter(
            (m) => m.muted_id !== mutedId
          ),
        }));
        setRelationshipFeedback("Account unmuted.");
        router.refresh();
      } else {
        setRelationshipFeedback(res.message || "Failed to unmute account.");
      }
    });
  };

  const handleExportData = () => {
    setExportError(null);
    startExportTransition(async () => {
      const res = await exportPersonalDataAction();
      if (!res.success || !res.data) {
        setExportError(res.message || "Unable to export personal data.");
        return;
      }
      setExportedPackage(res.data);

      try {
        const jsonString = JSON.stringify(res.data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `hiha-personal-data-${profile.username}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      } catch {
        // Fallback: inline JSON viewer is rendered below
      }
    });
  };

  const handleReactivate = () => {
    setSettingsFeedback(null);
    startSavingSettings(async () => {
      const res = await reactivateAccountAction();
      if (res.success && res.data) {
        setOverview((prev) => ({ ...prev, profile: res.data! }));
        setSettingsFeedback({
          type: "success",
          text: res.message || "Account reactivated.",
        });
        router.refresh();
      } else {
        setSettingsFeedback({
          type: "error",
          text: res.message || "Unable to reactivate account.",
        });
      }
    });
  };

  const handleAccountLifecycleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDeletionError(null);
    setDeletionSuccess(null);

    startDeletionTransition(async () => {
      const res = await deleteOrDeactivateAccountAction({
        mode: deletionMode,
        currentPassword,
        confirmationPhrase,
      });

      if (!res.success) {
        setDeletionError(res.message || "Unable to process account request.");
      } else {
        setDeletionSuccess(
          res.message ||
            "Account lifecycle action completed. Refreshing status..."
        );
        setCurrentPassword("");
        setConfirmationPhrase("");
        if (deletionMode === "permanent_delete") {
          setTimeout(() => {
            router.push("/login");
            router.refresh();
          }, 1200);
        } else {
          router.refresh();
        }
      }
    });
  };

  const expectedPhrase =
    deletionMode === "permanent_delete"
      ? "DELETE MY ACCOUNT"
      : "DEACTIVATE MY ACCOUNT";

  return (
    <div className="space-y-8">
      {/* Deactivated Account Banner */}
      {overview.profile.deactivated_at && (
        <div
          role="alert"
          className="p-4 rounded-[var(--radius-md)] border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="space-y-1 text-xs text-amber-900 dark:text-amber-200">
            <p className="font-bold">
              Your account is currently deactivated and scrubbed from public view.
            </p>
            <p>
              All posts are unpublished and collaborative consents are withdrawn.
              You can restore your account to active status below.
            </p>
          </div>
          <button
            type="button"
            disabled={isSavingSettings}
            onClick={handleReactivate}
            className="shrink-0 py-2 px-4 text-xs font-semibold rounded-[var(--radius-sm)] bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
          >
            Reactivate Account
          </button>
        </div>
      )}

      {/* Section 1: Privacy, Discoverability, Age Safety & Notification Controls */}
      <form
        onSubmit={handleSaveSettings}
        className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-8"
      >
        <div className="border-b border-[var(--border)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-[var(--foreground)]">
              1. Account Privacy, Discoverability &amp; Interaction Boundaries
            </h2>
            <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
              Enforced server-side and at the Postgres RLS level across profile views, feeds, communities, searches, likes, and collaborative video projects.
            </p>
          </div>
          <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-[var(--surface-muted)] text-[var(--foreground-secondary)] border border-[var(--border)]">
            @{overview.profile.username}
          </span>
        </div>

        {settingsFeedback && (
          <div
            role="status"
            className={`p-3 text-xs rounded-[var(--radius-sm)] border ${
              settingsFeedback.type === "success"
                ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
                : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
            }`}
          >
            {settingsFeedback.text}
          </div>
        )}

        {/* Age-Aware Safety Foundation */}
        <div className="p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[var(--foreground)]">
                Age-Appropriate Safety Experience
              </h3>
              <p className="text-xs text-[var(--foreground-secondary)]">
                Data-minimized protection: HIHA never collects or stores birth dates.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[var(--surface)] text-[var(--foreground-muted)] border border-[var(--border)]">
                Assurance: {overview.profile.age_assurance_status}
              </span>
              {isTeenMode && (
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  Teen 13–17 Protected
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleAgeModeChange("standard")}
              className={`p-3.5 rounded-[var(--radius-sm)] border text-left transition-colors ${
                ageSafetyMode === "standard"
                  ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--foreground)]"
                  : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground-muted)]"
              }`}
            >
              <div className="text-xs font-bold text-[var(--foreground)]">
                Standard Experience (18+)
              </div>
              <div className="text-[11px] text-[var(--foreground-secondary)] mt-1 leading-relaxed">
                Full control over public or private profile visibility, directory search, and post audience defaults.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleAgeModeChange("teen_13_17")}
              className={`p-3.5 rounded-[var(--radius-sm)] border text-left transition-colors ${
                ageSafetyMode === "teen_13_17"
                  ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--foreground)]"
                  : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground-muted)]"
              }`}
            >
              <div className="text-xs font-bold text-[var(--foreground)]">
                Teen Protective Mode (Ages 13–17)
              </div>
              <div className="text-[11px] text-[var(--foreground-secondary)] mt-1 leading-relaxed">
                Locks protective boundaries: private profile, hidden from directory search, follower approval required, followers-only interactions, and no globally public posts or projects.
              </div>
            </button>
          </div>

          <p className="text-[11px] text-[var(--foreground-muted)] leading-relaxed border-t border-[var(--border-subtle)] pt-2">
            <strong>Age Assurance Transparency:</strong> Self-attestation enables protective defaults without collecting birth dates or government IDs, and is never represented as proof of legal age. Where jurisdictional rules require stronger age assurance, HIHA&apos;s{" "}
            <code className="font-mono text-[10px]">AgeAssuranceProvider</code>{" "}
            contract accepts zero-knowledge age-bracket tokens without storing raw identity documents.
          </p>
        </div>

        {/* Profile Visibility & Directory Discoverability */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label
            className={`flex items-start gap-3 p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] ${
              isTeenMode ? "opacity-75 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={isPrivate}
              disabled={isTeenMode}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)]"
            />
            <div className="space-y-1">
              <span className="text-xs font-bold text-[var(--foreground)] block">
                Private Profile {isTeenMode && "(Required in Teen Mode)"}
              </span>
              <span className="text-[11px] text-[var(--foreground-secondary)] block leading-relaxed">
                Restricts your profile metadata and followers-only posts to approved followers.
              </span>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] ${
              isTeenMode ? "opacity-75 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={discoverableInSearch}
              disabled={isTeenMode}
              onChange={(e) => setDiscoverableInSearch(e.target.checked)}
              className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)]"
            />
            <div className="space-y-1">
              <span className="text-xs font-bold text-[var(--foreground)] block">
                Discoverable in Member Directory{" "}
                {isTeenMode && "(Disabled in Teen Mode)"}
              </span>
              <span className="text-[11px] text-[var(--foreground-secondary)] block leading-relaxed">
                Controls whether your account appears in the Network &amp; Creator directory listing.
              </span>
            </div>
          </label>
        </div>

        {/* Follow, Interaction & Default Post Visibility */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="followPermission"
              className="block text-xs font-semibold text-[var(--foreground)]"
            >
              Who Can Follow You
            </label>
            <select
              id="followPermission"
              value={followPermission}
              onChange={(e) =>
                setFollowPermission(e.target.value as FollowPermission)
              }
              className="w-full p-2.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
            >
              {!isTeenMode && (
                <option value="everyone">
                  Everyone (Instant if public profile)
                </option>
              )}
              <option value="approval_required">
                Approval Required (Pending request)
              </option>
              <option value="nobody">Nobody (Close new follows)</option>
            </select>
            <p className="text-[11px] text-[var(--foreground-muted)]">
              Enforced on all incoming follow requests.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="interactionPermission"
              className="block text-xs font-semibold text-[var(--foreground)]"
            >
              Who Can Interact With You
            </label>
            <select
              id="interactionPermission"
              value={interactionPermission}
              onChange={(e) =>
                setInteractionPermission(
                  e.target.value as InteractionPermission
                )
              }
              className="w-full p-2.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
            >
              {!isTeenMode && (
                <option value="everyone">
                  Everyone (Non-blocked accounts)
                </option>
              )}
              <option value="followers_only">Approved Followers Only</option>
              <option value="nobody">Nobody (Only me)</option>
            </select>
            <p className="text-[11px] text-[var(--foreground-muted)]">
              Applies to post likes and collaborative project invitations.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="defaultPostVisibility"
              className="block text-xs font-semibold text-[var(--foreground)]"
            >
              Default Post Visibility
            </label>
            <select
              id="defaultPostVisibility"
              value={defaultPostVisibility}
              onChange={(e) =>
                setDefaultPostVisibility(
                  e.target.value as DefaultPostVisibility
                )
              }
              className="w-full p-2.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
            >
              {!isTeenMode && <option value="public">Public</option>}
              <option value="followers">Followers Only</option>
              <option value="private">Private (Only Me)</option>
            </select>
            <p className="text-[11px] text-[var(--foreground-muted)]">
              Pre-selected audience when creating new posts.
            </p>
          </div>
        </div>

        {/* Notification Preferences */}
        <div className="pt-4 border-t border-[var(--border)] space-y-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">
              Notification Preferences
            </h3>
            <p className="text-xs text-[var(--foreground-muted)]">
              Choose which relationship events generate in-app notifications.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2.5 p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnFollowRequest}
                onChange={(e) => setNotifyOnFollowRequest(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)]"
              />
              <span>Incoming follow requests</span>
            </label>
            <label className="flex items-center gap-2.5 p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnNewFollower}
                onChange={(e) => setNotifyOnNewFollower(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)]"
              />
              <span>New followers</span>
            </label>
            <label className="flex items-center gap-2.5 p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnFollowAccepted}
                onChange={(e) => setNotifyOnFollowAccepted(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)]"
              />
              <span>Accepted follow requests</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSavingSettings}
            className="py-2.5 px-5 text-xs font-semibold rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSavingSettings
              ? "Saving Privacy & Safety Settings..."
              : "Save Privacy & Safety Settings"}
          </button>
        </div>
      </form>

      {/* Section 2: Blocked & Muted Accounts */}
      <section className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-6">
        <div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            2. Blocked &amp; Muted Accounts
          </h2>
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
            Blocking severs follow connections in both directions and blocks profile, post, community, and media visibility. Muting quietly removes a creator&apos;s posts from your feeds and community discussions.
          </p>
        </div>

        {relationshipFeedback && (
          <div className="p-3 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)]">
            {relationshipFeedback}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Blocked Accounts */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                Blocked Accounts
              </h3>
              <span className="text-[11px] font-mono text-[var(--foreground-muted)]">
                {overview.blockedAccounts.length} blocked
              </span>
            </div>
            <div className="divide-y divide-[var(--border)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]">
              {overview.blockedAccounts.map((item) => (
                <div
                  key={item.id}
                  className="p-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[var(--foreground)]">
                      Blocked Account
                    </div>
                    <div className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      ID: {item.blocked_id.slice(0, 8)}...
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isRelationshipPending}
                    onClick={() => handleUnblock(item.blocked_id)}
                    className="py-1 px-2.5 text-[11px] font-medium rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]"
                  >
                    Unblock
                  </button>
                </div>
              ))}
              {overview.blockedAccounts.length === 0 && (
                <div className="p-4 text-center text-xs text-[var(--foreground-muted)]">
                  No blocked accounts.
                </div>
              )}
            </div>
          </div>

          {/* Muted Accounts */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                Muted Accounts
              </h3>
              <span className="text-[11px] font-mono text-[var(--foreground-muted)]">
                {overview.mutedAccounts.length} muted
              </span>
            </div>
            <div className="divide-y divide-[var(--border)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]">
              {overview.mutedAccounts.map((item) => (
                <div
                  key={item.id}
                  className="p-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[var(--foreground)]">
                      {item.profile?.display_name || "Account"}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--foreground-muted)]">
                      {item.profile?.username
                        ? `@${item.profile.username}`
                        : item.muted_id.slice(0, 8)}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isRelationshipPending}
                    onClick={() => handleUnmute(item.muted_id)}
                    className="py-1 px-2.5 text-[11px] font-medium rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]"
                  >
                    Unmute
                  </button>
                </div>
              ))}
              {overview.mutedAccounts.length === 0 && (
                <div className="p-4 text-center text-xs text-[var(--foreground-muted)]">
                  No muted accounts.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Personal Data Summary & Export */}
      <section className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--foreground)]">
              3. Your Stored Personal Data &amp; Portable Export
            </h2>
            <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
              Inspect the categories of personal data stored for your account and download a machine-readable JSON archive. Exports are strictly scoped to your authenticated session and exclude other users&apos; private data and internal moderation secrets.
            </p>
          </div>
          <button
            type="button"
            disabled={isExporting}
            onClick={handleExportData}
            className="shrink-0 py-2.5 px-4 text-xs font-semibold rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
          >
            {isExporting ? "Preparing Export..." : "Download JSON Data Export"}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[
            { label: "Posts", value: overview.storageSummary.postsCount },
            {
              label: "Topic Interests",
              value: overview.interests.length,
            },
            {
              label: "Consented Collab Clips",
              value: overview.storageSummary.activeConsentedClipsCount,
            },
            {
              label: "Reports Filed",
              value: overview.storageSummary.submittedReportsCount,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]"
            >
              <div className="text-base font-extrabold font-mono text-[var(--foreground)]">
                {stat.value}
              </div>
              <div className="text-[11px] text-[var(--foreground-muted)] mt-0.5">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {exportError && (
          <div className="p-3 text-xs rounded-[var(--radius-sm)] border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">
            {exportError}
          </div>
        )}

        {exportedPackage && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                Export generated ({exportedPackage.schema_version}) at{" "}
                {new Date(exportedPackage.exported_at).toLocaleTimeString()}
              </span>
              <button
                type="button"
                onClick={() => setExportedPackage(null)}
                className="text-[11px] underline text-[var(--foreground-muted)]"
              >
                Hide preview
              </button>
            </div>
            <pre className="p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[11px] font-mono overflow-x-auto max-h-72">
              {JSON.stringify(exportedPackage, null, 2)}
            </pre>
          </div>
        )}
      </section>

      {/* Section 4: Account Deactivation & Permanent Deletion */}
      <section className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-red-300 dark:border-red-900/70 bg-[var(--surface)] space-y-6">
        <div>
          <h2 className="text-lg font-bold text-red-700 dark:text-red-400">
            4. Account Deactivation &amp; Permanent Deletion
          </h2>
          <p className="text-xs text-[var(--foreground-secondary)] mt-1 leading-relaxed">
            Requires password re-authentication and an explicit confirmation phrase to prevent accidental or CSRF-triggered loss of account access.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] space-y-1.5">
            <div className="font-bold text-[var(--foreground)]">
              What Happens to Your Content, Communities &amp; Collaborations
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-[var(--foreground-secondary)]">
              <li>
                <strong>Deactivate &amp; Scrub:</strong> Scrubs your profile PII, sets your profile to private and undiscoverable, unpublishes all posts to draft status, and automatically withdraws consent on all collaborative clips (invalidating and deleting stitched render outputs). Your post drafts and personal source media remain securely preserved for account reactivation.
              </li>
              <li>
                <strong>Permanent Deletion:</strong> Irreversibly deletes your account, user profile, personal media files in storage, follows, likes, and topic preferences.
              </li>
              <li>
                <strong>Owned Communities (Option 1B):</strong> Communities where you are the sole member are permanently deleted. If you own communities with other active members, ownership transfer is required before permanent deletion.
              </li>
              <li>
                <strong>Collaborative Projects (Option 2A):</strong> Projects you own and their rendered outputs will be permanently deleted. Source video clips submitted by other contributors remain preserved in their accounts.
              </li>
            </ul>
          </div>

          <div className="p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] space-y-1.5">
            <div className="font-bold text-[var(--foreground)]">
              Safety &amp; Moderation Audit Retention
            </div>
            <p className="text-[11px] text-[var(--foreground-secondary)] leading-relaxed">
              Before deactivation or deletion, active or historical trust-and-safety enforcement records are summarized into an anonymized ledger (<code className="font-mono">moderation_retention_ledger</code>) containing only hashed subject identifiers, action types, reasons, and timestamps—never your email, username, or profile content—so platform safety integrity is preserved without retaining your personal identity.
            </p>
            {overview.storageSummary.ownedProjectsCount !== undefined && overview.storageSummary.ownedProjectsCount > 0 && (
              <div className="pt-2 text-[11px] text-amber-800 dark:text-amber-300">
                You own <strong>{overview.storageSummary.ownedProjectsCount}</strong> collaborative project(s). These will be removed upon permanent deletion.
              </div>
            )}
          </div>
        </div>

        {/* Blocking Notice for Multi-Member Community Owners */}
        {deletionMode === "permanent_delete" &&
          (overview.storageSummary.ownedMultiMemberCommunitiesCount ?? 0) > 0 && (
            <div
              role="alert"
              className="p-4 rounded-[var(--radius-sm)] border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 space-y-1"
            >
              <p className="font-bold">
                Action Required Before Account Deletion: Transfer Community Ownership
              </p>
              <p className="text-[11px]">
                You currently own{" "}
                <strong>{overview.storageSummary.ownedMultiMemberCommunitiesCount}</strong>{" "}
                community(ies) with active members. To protect the community and its members, you must transfer ownership to another active member before your account can be permanently deleted.
              </p>
            </div>
          )}

        {/* Incomplete Deletion Recovery Banner */}
        {overview.storageSummary.deletionIncomplete && (
          <div
            role="alert"
            className="p-4 rounded-[var(--radius-sm)] border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-900 dark:text-red-200 space-y-1"
          >
            <p className="font-bold">
              Account Deletion Incomplete — Action Required
            </p>
            <p className="text-[11px]">
              Your profile content, posts, and stored media have been removed, but administrative authentication account deletion did not complete. Your login credentials remain active until removed. Please re-enter your password and confirm &quot;DELETE MY ACCOUNT&quot; below to retry and complete permanent deletion.
            </p>
          </div>
        )}

        {deletionError && (
          <div
            role="alert"
            className="p-3 text-xs rounded-[var(--radius-sm)] border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
          >
            {deletionError}
          </div>
        )}

        {deletionSuccess && (
          <div
            role="alert"
            className="p-3 text-xs rounded-[var(--radius-sm)] border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
          >
            {deletionSuccess}
          </div>
        )}

        <form onSubmit={handleAccountLifecycleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setDeletionMode("deactivate_and_scrub");
                setConfirmationPhrase("");
              }}
              className={`p-3 rounded-[var(--radius-sm)] border text-left text-xs ${
                deletionMode === "deactivate_and_scrub"
                  ? "border-[var(--accent)] bg-[var(--surface-muted)] font-semibold"
                  : "border-[var(--border)] bg-[var(--background)]"
              }`}
            >
              <div>Deactivate &amp; Scrub Account (Reversible)</div>
              <div className="text-[11px] font-normal text-[var(--foreground-muted)] mt-0.5">
                Hides profile &amp; posts, withdraws collaborative clip consent.
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setDeletionMode("permanent_delete");
                setConfirmationPhrase("");
              }}
              className={`p-3 rounded-[var(--radius-sm)] border text-left text-xs ${
                deletionMode === "permanent_delete"
                  ? "border-red-600 bg-red-50/40 dark:bg-red-950/30 font-semibold text-red-700 dark:text-red-300"
                  : "border-[var(--border)] bg-[var(--background)]"
              }`}
            >
              <div>Permanently Delete Account Content &amp; Sign Out</div>
              <div className="text-[11px] font-normal text-[var(--foreground-muted)] mt-0.5">
                Deletes posts, likes, follows, and preferences and signs out.
              </div>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label
                htmlFor="currentPassword"
                className="block text-xs font-medium text-[var(--foreground)]"
              >
                Confirm Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="confirmationPhrase"
                className="block text-xs font-medium text-[var(--foreground)]"
              >
                Type <code className="font-mono font-bold">{expectedPhrase}</code>
              </label>
              <input
                id="confirmationPhrase"
                type="text"
                required
                value={confirmationPhrase}
                onChange={(e) => setConfirmationPhrase(e.target.value)}
                placeholder={expectedPhrase}
                className="w-full px-3 py-2 text-xs font-mono rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Link
              href="/policies"
              className="text-xs text-[var(--foreground-muted)] underline hover:text-[var(--foreground)]"
            >
              Read Data Deletion &amp; Retention Policy
            </Link>
            <button
              type="submit"
              disabled={
                isDeleting ||
                confirmationPhrase.trim() !== expectedPhrase ||
                (deletionMode === "permanent_delete" &&
                  (overview.storageSummary.ownedMultiMemberCommunitiesCount ?? 0) > 0)
              }
              className="py-2.5 px-5 text-xs font-semibold rounded-[var(--radius-sm)] bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-opacity"
            >
              {isDeleting
                ? "Processing..."
                : deletionMode === "permanent_delete"
                  ? "Permanently Delete My Account"
                  : "Deactivate & Scrub My Account"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
