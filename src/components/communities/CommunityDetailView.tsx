"use client";

import React, { useState, useEffect, useTransition, useCallback } from "react";
import Link from "next/link";
import type {
  CommunityWithDetails,
  CommunityMemberWithProfile,
} from "@/lib/communities/types";
import {
  joinCommunityAction,
  leaveCommunityAction,
  getCommunityMembersAction,
  getCommunityPendingRequestsAction,
  respondToMembershipRequestAction,
  updateMemberRoleAction,
  transferCommunityOwnershipAction,
  removeCommunityMemberAction,
} from "@/app/actions/communities";
import {
  getCommunityPostsAction,
  type CommunityPostWithDetails,
} from "@/app/actions/community-posts";
import { CommunityPostCard } from "./CommunityPostCard";
import { ShareToCommunityModal } from "./ShareToCommunityModal";

interface CommunityDetailViewProps {
  initialCommunity: CommunityWithDetails;
  viewerId?: string | null;
}

export function CommunityDetailView({ initialCommunity, viewerId }: CommunityDetailViewProps) {
  const [community, setCommunity] = useState(initialCommunity);
  const [membership, setMembership] = useState(initialCommunity.viewerMembership);
  const [memberCount, setMemberCount] = useState(initialCommunity.memberCount);
  const [activeTab, setActiveTab] = useState<"discussions" | "about" | "members" | "requests">("discussions");

  const [posts, setPosts] = useState<CommunityPostWithDetails[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const [members, setMembers] = useState<CommunityMemberWithProfile[]>([]);
  const [requests, setRequests] = useState<CommunityMemberWithProfile[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isOwner = membership?.role === "owner";
  const isModerator = membership?.role === "moderator";
  const isStaff = isOwner || isModerator;
  const isActiveMember = membership?.status === "active";
  const isPendingRequest = membership?.status === "pending";

  const fetchCommunityPosts = useCallback(() => {
    setPostsLoading(true);
    getCommunityPostsAction({ communityId: community.id })
      .then((res) => {
        if (res.success && res.data) {
          setPosts(res.data.items);
        }
      })
      .catch(() => {})
      .finally(() => setPostsLoading(false));
  }, [community.id]);

  useEffect(() => {
    fetchCommunityPosts();
  }, [fetchCommunityPosts]);

  useEffect(() => {
    if (activeTab === "members") {
      setLoadingData(true);
      getCommunityMembersAction(community.id).then((res) => {
        if (res.success && res.data) setMembers(res.data.items);
        setLoadingData(false);
      }).catch(() => setLoadingData(false));
    } else if (activeTab === "requests" && isStaff) {
      setLoadingData(true);
      getCommunityPendingRequestsAction(community.id).then((res) => {
        if (res.success && res.data) setRequests(res.data);
        setLoadingData(false);
      }).catch(() => setLoadingData(false));
    }
  }, [activeTab, community.id, isStaff]);

  const handleJoin = () => {
    if (isPending) return;
    setActionMessage(null);
    startTransition(async () => {
      try {
        const res = await joinCommunityAction(community.id);
        if (res.success && res.data) {
          if (res.data.status === "active") {
            setMembership({ role: "member", status: "active" });
            setMemberCount((c) => c + 1);
            setActionMessage("You have joined the community.");
          } else {
            setMembership({ role: "member", status: "pending" });
            setActionMessage("Membership request submitted to moderators.");
          }
        } else {
          setActionMessage("Unable to join. Access may be restricted.");
        }
      } catch {
        setActionMessage("Unable to join. Access may be restricted.");
      }
    });
  };

  const handleLeave = () => {
    if (isPending || isOwner) return;
    setActionMessage(null);
    startTransition(async () => {
      try {
        const res = await leaveCommunityAction(community.id);
        if (res.success) {
          setMembership(null);
          setMemberCount((c) => Math.max(1, c - 1));
          setActionMessage("You have left the community.");
        } else {
          setActionMessage(res.message || "Unable to leave.");
        }
      } catch {
        setActionMessage("Unable to leave community.");
      }
    });
  };

  const handleRequestDecision = (targetUserId: string, decision: "approve" | "reject") => {
    startTransition(async () => {
      const res = await respondToMembershipRequestAction({
        communityId: community.id,
        targetUserId,
        decision,
      });
      if (res.success) {
        setRequests((prev) => prev.filter((r) => r.user_id !== targetUserId));
        if (decision === "approve") {
          setMemberCount((c) => c + 1);
        }
        setActionMessage(res.message || "Decision recorded.");
      }
    });
  };

  const handleRoleUpdate = (targetUserId: string, newRole: "moderator" | "member") => {
    startTransition(async () => {
      const res = await updateMemberRoleAction({
        communityId: community.id,
        targetUserId,
        newRole,
      });
      if (res.success) {
        setMembers((prev) =>
          prev.map((m) => (m.user_id === targetUserId ? { ...m, role: newRole } : m))
        );
        setActionMessage(`Role updated to ${newRole}.`);
      }
    });
  };

  const handleTransferOwnership = (newOwnerId: string) => {
    if (!window.confirm("Are you sure you want to transfer ownership? You will become a moderator.")) return;
    startTransition(async () => {
      const res = await transferCommunityOwnershipAction({
        communityId: community.id,
        newOwnerId,
      });
      if (res.success) {
        setMembership({ role: "moderator", status: "active" });
        setCommunity((prev) => ({ ...prev, owner_id: newOwnerId }));
        setActionMessage("Ownership transferred successfully.");
      }
    });
  };

  const handleRemoveMember = (targetUserId: string) => {
    startTransition(async () => {
      const res = await removeCommunityMemberAction({
        communityId: community.id,
        targetUserId,
      });
      if (res.success) {
        setMembers((prev) => prev.filter((m) => m.user_id !== targetUserId));
        setMemberCount((c) => Math.max(1, c - 1));
        setActionMessage("Member removed from community.");
      }
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* Back Link */}
      <Link
        href="/communities"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors"
      >
        ← Back to Communities
      </Link>

      {/* Community Banner & Header */}
      <div className="p-6 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
                {community.name}
              </h1>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  community.visibility === "public"
                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-850"
                    : "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-850"
                }`}
              >
                {community.visibility}
              </span>
            </div>
            <p className="text-xs font-mono text-[var(--foreground-muted)] mt-0.5">
              c/{community.slug}
            </p>
          </div>

          {/* Membership CTA */}
          <div className="flex items-center gap-2">
            {isOwner ? (
              <span className="text-xs font-mono font-semibold px-3 py-1.5 rounded bg-[var(--surface-muted)] text-[var(--foreground)] border border-[var(--border)]">
                Owner
              </span>
            ) : isModerator ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-semibold px-3 py-1.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900">
                  Moderator
                </span>
                <button
                  type="button"
                  onClick={handleLeave}
                  disabled={isPending}
                  className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--foreground-muted)] hover:text-red-600 transition-colors"
                >
                  Leave
                </button>
              </div>
            ) : isActiveMember ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-3 py-1.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                  Member
                </span>
                <button
                  type="button"
                  onClick={handleLeave}
                  disabled={isPending}
                  className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--foreground-muted)] hover:text-red-600 transition-colors"
                >
                  Leave
                </button>
              </div>
            ) : isPendingRequest ? (
              <span className="text-xs font-medium px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                Request Pending
              </span>
            ) : (
              <button
                type="button"
                onClick={handleJoin}
                disabled={isPending}
                className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {community.visibility === "public" ? "Join Community" : "Request to Join"}
              </button>
            )}
          </div>
        </div>

        {/* Action message */}
        {actionMessage && (
          <div className="p-3 rounded bg-[var(--surface-muted)] border border-[var(--border)] text-xs text-[var(--foreground)]">
            {actionMessage}
          </div>
        )}

        {/* Stats bar */}
        <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-[var(--foreground-muted)] border-t border-[var(--border-subtle)]">
          <span>{memberCount} active member{memberCount === 1 ? "" : "s"}</span>
          <span>•</span>
          <span>Created by @{community.owner?.username || "founder"}</span>
          {community.category && (
            <>
              <span>•</span>
              <span className="capitalize">{community.category.replace(/-/g, " ")}</span>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] text-sm">
        <button
          type="button"
          onClick={() => setActiveTab("discussions")}
          className={`px-4 py-2 border-b-2 font-medium transition-colors ${
            activeTab === "discussions"
              ? "border-[var(--accent)] text-[var(--foreground)]"
              : "border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
          }`}
        >
          Discussions
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("about")}
          className={`px-4 py-2 border-b-2 font-medium transition-colors ${
            activeTab === "about"
              ? "border-[var(--accent)] text-[var(--foreground)]"
              : "border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
          }`}
        >
          About
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("members")}
          className={`px-4 py-2 border-b-2 font-medium transition-colors ${
            activeTab === "members"
              ? "border-[var(--accent)] text-[var(--foreground)]"
              : "border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
          }`}
        >
          Members ({memberCount})
        </button>
        {isStaff && community.visibility === "private" && (
          <button
            type="button"
            onClick={() => setActiveTab("requests")}
            className={`px-4 py-2 border-b-2 font-medium transition-colors ${
              activeTab === "requests"
                ? "border-[var(--accent)] text-[var(--foreground)]"
                : "border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            }`}
          >
            Pending Requests
          </button>
        )}
      </div>

      {/* Tab Panels */}
      {activeTab === "discussions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
              Discussions
            </h2>
            {isActiveMember && (
              <button
                type="button"
                onClick={() => setIsShareModalOpen(true)}
                className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                + Share a Post
              </button>
            )}
          </div>

          {postsLoading ? (
            <div className="p-8 text-center text-xs text-[var(--foreground-muted)]">
              Loading community discussions…
            </div>
          ) : posts.length === 0 ? (
            <div className="p-8 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-center space-y-2">
              <p className="text-sm font-medium text-[var(--foreground)]">No discussions yet</p>
              <p className="text-xs text-[var(--foreground-muted)]">
                {isActiveMember
                  ? "Be the first to share one of your published posts into this community!"
                  : "Join this community to participate and share posts."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((cp) => (
                <CommunityPostCard
                  key={cp.id}
                  item={cp}
                  viewerId={viewerId}
                  isStaff={isStaff}
                  onPostUpdated={fetchCommunityPosts}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "about" && (
        <div className="p-6 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
            About this Space
          </h2>
          <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
            {community.description || "No description provided for this community yet."}
          </p>
        </div>
      )}

      {activeTab === "members" && (
        <div className="space-y-3">
          {loadingData ? (
            <div className="p-8 text-center text-xs text-[var(--foreground-muted)]">
              Loading members…
            </div>
          ) : members.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--foreground-muted)]">
              No members found.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
              {members.map((m) => (
                <div key={m.id} className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-semibold text-[var(--foreground)]">
                      {m.user?.display_name || m.user?.username || "Member"}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)] ml-2">
                      @{m.user?.username}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                        m.role === "owner"
                          ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-850"
                          : m.role === "moderator"
                          ? "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-850"
                          : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] border-[var(--border)]"
                      }`}
                    >
                      {m.role}
                    </span>

                    {/* Owner controls for staff promotion and transfer */}
                    {isOwner && m.user_id !== community.owner_id && (
                      <div className="flex items-center gap-1.5 ml-2">
                        {m.role === "member" ? (
                          <button
                            type="button"
                            onClick={() => handleRoleUpdate(m.user_id, "moderator")}
                            disabled={isPending}
                            className="text-[11px] text-[var(--accent)] hover:underline"
                          >
                            Make Mod
                          </button>
                        ) : m.role === "moderator" ? (
                          <button
                            type="button"
                            onClick={() => handleRoleUpdate(m.user_id, "member")}
                            disabled={isPending}
                            className="text-[11px] text-[var(--foreground-muted)] hover:underline"
                          >
                            Remove Mod
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => handleTransferOwnership(m.user_id)}
                          disabled={isPending}
                          className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                        >
                          Transfer Owner
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.user_id)}
                          disabled={isPending}
                          className="text-[11px] text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "requests" && isStaff && (
        <div className="space-y-3">
          {loadingData ? (
            <div className="p-8 text-center text-xs text-[var(--foreground-muted)]">
              Loading requests…
            </div>
          ) : requests.length === 0 ? (
            <div className="p-8 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-center text-xs text-[var(--foreground-muted)]">
              No pending membership requests.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
              {requests.map((r) => (
                <div key={r.id} className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-semibold text-[var(--foreground)]">
                      {r.user?.display_name || r.user?.username || "User"}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)] ml-2">
                      @{r.user?.username}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRequestDecision(r.user_id, "approve")}
                      disabled={isPending}
                      className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestDecision(r.user_id, "reject")}
                      disabled={isPending}
                      className="px-3 py-1 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)] hover:text-red-600 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Share to Community Modal */}
      <ShareToCommunityModal
        isOpen={isShareModalOpen}
        communityId={community.id}
        communityName={community.name}
        onClose={() => setIsShareModalOpen(false)}
        onPostShared={fetchCommunityPosts}
      />
    </div>
  );
}
