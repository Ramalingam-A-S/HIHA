"use client";

import React, { useState, useTransition } from "react";
import type { CommunityPostWithDetails } from "@/app/actions/community-posts";
import { FeedMediaView } from "@/components/feed/FeedMediaView";
import { pinCommunityPostAction, removeCommunityPostAction } from "@/app/actions/community-posts";
import { ReportModal } from "@/components/reports/ReportModal";
import { ContentAuthenticityBadge } from "@/components/authenticity/ContentAuthenticityBadge";

interface CommunityPostCardProps {
  item: CommunityPostWithDetails;
  viewerId?: string | null;
  isStaff: boolean;
  onPostUpdated?: () => void;
}

export function CommunityPostCard({
  item,
  viewerId,
  isStaff,
  onPostUpdated,
}: CommunityPostCardProps) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRemovePrompt, setShowRemovePrompt] = useState(false);
  const [removalReason, setRemovalReason] = useState("");
  const [isReportOpen, setIsReportOpen] = useState(false);

  const post = item.post;
  const creator = post?.creator;
  const isPoster = viewerId && item.poster_id === viewerId;
  const isPinned = !!item.pinned_at;

  const handleTogglePin = () => {
    if (isPending) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await pinCommunityPostAction({
          communityPostId: item.id,
          pin: !isPinned,
        });
        if (res.success) {
          onPostUpdated?.();
        } else {
          setActionError(res.message || "Failed to update pin.");
        }
      } catch {
        setActionError("An error occurred while updating pin status.");
      }
    });
  };

  const handleRemove = (reason?: string) => {
    if (isPending) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await removeCommunityPostAction({
          communityPostId: item.id,
          removalReason: reason || null,
        });
        if (res.success) {
          setShowRemovePrompt(false);
          onPostUpdated?.();
        } else {
          setActionError(res.message || "Failed to remove post.");
        }
      } catch {
        setActionError("An error occurred while removing post.");
      }
    });
  };

  const sharedDate = new Date(item.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <article
      className={`p-5 rounded-[var(--radius-sm)] border bg-[var(--surface)] shadow-xs flex flex-col gap-3 transition-colors ${
        isPinned
          ? "border-amber-300 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-950/20"
          : "border-[var(--border)]"
      }`}
    >
      {/* Pinned status banner */}
      {isPinned && (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
          <span>📌</span>
          <span>Pinned by community moderators</span>
        </div>
      )}

      {/* Header: Creator & Actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[var(--surface-muted)] border border-[var(--border)] flex items-center justify-center font-bold text-xs text-[var(--foreground)] uppercase shrink-0">
            {creator?.display_name?.charAt(0) || creator?.username?.charAt(0) || "U"}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-[var(--foreground)] truncate">
              {creator?.display_name || creator?.username || "Community Member"}
            </span>
            <span className="text-xs text-[var(--foreground-muted)] truncate">
              @{creator?.username || "member"} • {sharedDate}
            </span>
          </div>
        </div>

        {/* Moderation & Author Controls */}
        <div className="flex items-center gap-1.5 text-xs">
          {isStaff && (
            <button
              type="button"
              onClick={handleTogglePin}
              disabled={isPending}
              aria-label={isPinned ? "Unpin post" : "Pin post"}
              className="px-2 py-1 rounded border border-[var(--border)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors text-[11px]"
            >
              {isPinned ? "Unpin" : "Pin"}
            </button>
          )}

          {isPoster && !isStaff && (
            <button
              type="button"
              onClick={() => handleRemove()}
              disabled={isPending}
              className="px-2 py-1 rounded border border-[var(--border)] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors text-[11px]"
            >
              Retract
            </button>
          )}

          {isStaff && (
            <button
              type="button"
              onClick={() => setShowRemovePrompt(true)}
              disabled={isPending}
              className="px-2 py-1 rounded border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors text-[11px]"
            >
              Remove
            </button>
          )}

          {!isPoster && (
            <button
              type="button"
              onClick={() => setIsReportOpen(true)}
              aria-label="Report this post"
              className="px-2 py-1 rounded border border-[var(--border)] text-[var(--foreground-muted)] hover:text-red-600 dark:hover:text-red-400 transition-colors text-[11px]"
            >
              Report
            </button>
          )}
        </div>
      </div>

      {/* Moderation removal dialog */}
      {showRemovePrompt && (
        <div className="p-3 rounded bg-[var(--surface-muted)] border border-red-200 dark:border-red-900 flex flex-col gap-2">
          <p className="text-xs font-medium text-[var(--foreground)]">
            Remove this post from the community feed?
          </p>
          <input
            type="text"
            placeholder="Reason for removal (optional)"
            value={removalReason}
            onChange={(e) => setRemovalReason(e.target.value)}
            maxLength={500}
            className="w-full text-xs px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
          />
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowRemovePrompt(false)}
              disabled={isPending}
              className="px-2.5 py-1 text-xs rounded border border-[var(--border)] text-[var(--foreground-muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleRemove(removalReason)}
              disabled={isPending}
              className="px-2.5 py-1 text-xs rounded bg-red-600 text-white font-medium hover:bg-red-700"
            >
              Confirm Removal
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <p className="text-xs text-red-600 dark:text-red-400">{actionError}</p>
      )}

      {/* Post Caption */}
      {post?.caption && (
        <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
          {post.caption}
        </p>
      )}

      {/* Media View */}
      {post?.content_type && post.content_type !== "text" && (
        <FeedMediaView postId={post.id} contentType={post.content_type} />
      )}

      {/* Content Authenticity & AI Disclosure Badge */}
      {post && (
        <ContentAuthenticityBadge
          status={post.ai_disclosure_status}
          details={post.ai_disclosure_details}
          disclosedAt={post.ai_disclosed_at}
          provenanceStatus={post.provenance_status}
          compact
        />
      )}

      <ReportModal
        isOpen={isReportOpen}
        targetType="community_post"
        targetId={item.id}
        targetTitle={post?.caption ? post.caption.slice(0, 50) : undefined}
        onClose={() => setIsReportOpen(false)}
      />
    </article>
  );
}
