"use client";

import React, { useState, useTransition } from "react";
import type { FeedItem } from "@/lib/feed/types";
import { FeedMediaView } from "./FeedMediaView";
import { likePostAction, unlikePostAction } from "@/app/actions/likes";
import { updatePostAction } from "@/app/actions/posts";
import { ReportModal } from "@/components/reports/ReportModal";
import { ContentAuthenticityBadge } from "@/components/authenticity/ContentAuthenticityBadge";
import { AiDisclosureSelector } from "@/components/authenticity/AiDisclosureSelector";
import type { AiDisclosureStatus, ProvenanceStatus } from "@/lib/authenticity/types";

interface FeedCardProps {
  item: FeedItem;
}

export function FeedCard({ item }: FeedCardProps) {
  const [showExplanation, setShowExplanation] = useState(false);
  const [liked, setLiked] = useState(item.isLikedByViewer ?? false);
  const [likeCount, setLikeCount] = useState(item.likeCount ?? 0);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [caption, setCaption] = useState(item.caption ?? "");
  const [aiStatus, setAiStatus] = useState<AiDisclosureStatus>(
    item.ai_disclosure_status ?? "not_declared"
  );
  const [aiDetails, setAiDetails] = useState<string | null>(
    item.ai_disclosure_details ?? null
  );
  const [aiDisclosedAt, setAiDisclosedAt] = useState<string | null>(
    item.ai_disclosed_at ?? null
  );
  const [provenanceStatus, setProvenanceStatus] = useState<ProvenanceStatus>(
    item.provenance_status ?? "unverified"
  );

  const [isEditingDisclosure, setIsEditingDisclosure] = useState(false);
  const [editCaption, setEditCaption] = useState(item.caption ?? "");
  const [editStatus, setEditStatus] = useState<AiDisclosureStatus>(
    item.ai_disclosure_status ?? "not_declared"
  );
  const [editDetails, setEditDetails] = useState(
    item.ai_disclosure_details ?? ""
  );
  const [editFeedback, setEditFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const creator = item.creator;

  const handleToggleLike = () => {
    if (isPending) return;
    setLikeError(null);
    const prevLiked = liked;
    const prevCount = likeCount;

    // Optimistic state transition
    const nextLiked = !prevLiked;
    const nextCount = nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1);
    setLiked(nextLiked);
    setLikeCount(nextCount);

    startTransition(async () => {
      try {
        const res = nextLiked
          ? await likePostAction(item.id)
          : await unlikePostAction(item.id);

        if (res.success && res.data) {
          setLiked(res.data.isLiked);
          setLikeCount(res.data.likeCount);
        } else {
          // Reliable rollback on failure
          setLiked(prevLiked);
          setLikeCount(prevCount);
          setLikeError(res.message || "Unable to update like. Please try again.");
        }
      } catch {
        // Reliable rollback on error
        setLiked(prevLiked);
        setLikeCount(prevCount);
        setLikeError("Unable to update like. Please try again.");
      }
    });
  };

  const handleSaveDisclosure = () => {
    setEditFeedback(null);
    startTransition(async () => {
      const res = await updatePostAction({
        postId: item.id,
        caption: editCaption.trim() || null,
        ai_disclosure_status: editStatus,
        ai_disclosure_details:
          editStatus === "not_declared" ? null : editDetails.trim() || null,
      });

      if (res.success && res.data?.post) {
        const updated = res.data.post;
        setCaption(updated.caption ?? "");
        setAiStatus(updated.ai_disclosure_status);
        setAiDetails(updated.ai_disclosure_details);
        setAiDisclosedAt(updated.ai_disclosed_at);
        setProvenanceStatus(updated.provenance_status);
        setIsEditingDisclosure(false);
        setEditFeedback({
          type: "success",
          text: "Post disclosure and content updated.",
        });
      } else {
        setEditFeedback({
          type: "error",
          text: res.message || "Unable to update post disclosure.",
        });
      }
    });
  };

  const publishedDate = item.published_at
    ? new Date(item.published_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date(item.created_at).toLocaleDateString();

  return (
    <article className="p-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] shadow-xs flex flex-col gap-4">
      {/* Header: Creator Info & Visibility */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[var(--surface-muted)] border border-[var(--border)] flex items-center justify-center font-bold text-xs text-[var(--foreground)] uppercase shrink-0">
            {creator?.display_name?.charAt(0) || creator?.username?.charAt(0) || "U"}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-[var(--foreground)] truncate">
              {creator?.display_name || creator?.username || "Anonymous Creator"}
            </span>
            <span className="text-xs text-[var(--foreground-muted)] truncate">
              @{creator?.username || "unknown"} • {publishedDate}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {item.isOwner && (
            <button
              type="button"
              onClick={() => {
                setEditFeedback(null);
                setIsEditingDisclosure((prev) => !prev);
              }}
              className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {isEditingDisclosure ? "Cancel Edit" : "Edit Disclosure"}
            </button>
          )}
          {item.visibility === "followers" && (
            <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
              Followers
            </span>
          )}
          {item.visibility === "public" && (
            <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]">
              Public
            </span>
          )}
        </div>
      </div>

      {/* Content Authenticity & AI Disclosure Badge */}
      <div>
        <ContentAuthenticityBadge
          status={aiStatus}
          provenanceStatus={provenanceStatus}
          details={aiDetails}
          disclosedAt={aiDisclosedAt}
        />
      </div>

      {/* Creator Post & Disclosure Editor */}
      {item.isOwner && isEditingDisclosure && (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Update Caption
            </label>
            <textarea
              rows={2}
              maxLength={2200}
              value={editCaption}
              onChange={(e) => setEditCaption(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <AiDisclosureSelector
            status={editStatus}
            details={editDetails}
            onStatusChange={setEditStatus}
            onDetailsChange={setEditDetails}
            disabled={isPending}
            compact
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-500">
              Editing caption or disclosure updates the disclosure timestamp and resets any prior machine verification.
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSaveDisclosure}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {editFeedback && (
        <p
          className={`text-xs font-medium ${
            editFeedback.type === "success"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {editFeedback.text}
        </p>
      )}

      {/* Post Caption */}
      {caption && (
        <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
          {caption}
        </p>
      )}

      {/* Media View (if applicable) */}
      {item.content_type !== "text" && (
        <FeedMediaView
          postId={item.id}
          contentType={item.content_type}
        />
      )}

      {/* Topics & Categorization */}
      {item.interests && item.interests.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {item.interests.map((interest) => (
            <span
              key={interest.id}
              className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-muted)] text-[var(--foreground-secondary)] border border-[var(--border-subtle)]"
            >
              #{interest.name}
            </span>
          ))}
        </div>
      )}

      {/* Engagement Controls: Reliable Like Counter & Report Action */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleToggleLike}
            disabled={isPending}
            aria-pressed={liked}
            aria-label={
              liked
                ? `Unlike post. Current likes: ${likeCount}`
                : `Like post. Current likes: ${likeCount}`
            }
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-[var(--radius-sm)] border transition-colors ${
              liked
                ? "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900"
                : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] border-[var(--border)] hover:text-[var(--foreground)]"
            }`}
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {liked ? "♥" : "♡"}
            </span>
            <span>{likeCount}</span>
          </button>

          {likeError && (
            <span
              className="text-[11px] text-red-600 dark:text-red-400 font-medium"
              role="alert"
            >
              {likeError}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsReportOpen(true)}
          aria-label="Report this post"
          className="text-[11px] text-[var(--foreground-muted)] hover:text-red-600 dark:hover:text-red-400 transition-colors px-2 py-1 rounded"
        >
          Report
        </button>
      </div>

      {/* Transparent Explanation Tags & Why Disclosure */}
      <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Explanation Tags */}
          <div className="flex flex-wrap items-center gap-1.5">
            {item.explanationTags.map((tag, idx) => {
              const isHighPriority = tag.startsWith("High Priority");
              const isFollowing = tag === "Following";
              const isExplore = tag === "Exploration";

              return (
                <span
                  key={idx}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    isHighPriority
                      ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-850"
                      : isFollowing
                      ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-850"
                      : isExplore
                      ? "bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-850"
                      : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] border-[var(--border)]"
                  }`}
                >
                  {tag}
                </span>
              );
            })}
          </div>

          {/* Transparent Score Disclosure Trigger */}
          {item.explanationDetails.length > 0 && (
            <button
              type="button"
              onClick={() => setShowExplanation(!showExplanation)}
              className="text-[11px] text-[var(--accent)] hover:underline focus:outline-none font-medium ml-auto"
            >
              {showExplanation ? "Hide breakdown" : "Why am I seeing this?"}
            </button>
          )}
        </div>

        {/* Expanded Ranking Transparency Details */}
        {showExplanation && (
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface-muted)] border border-[var(--border)] space-y-1.5 text-xs text-[var(--foreground-secondary)]">
            <div className="font-semibold text-[11px] uppercase tracking-wider text-[var(--foreground-muted)]">
              Deterministic Ranking Breakdown (Score: {item.score})
            </div>
            <ul className="list-disc list-inside space-y-1">
              {item.explanationDetails.map((detail, idx) => (
                <li key={idx} className="leading-relaxed">
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ReportModal
        isOpen={isReportOpen}
        targetType="post"
        targetId={item.id}
        targetTitle={caption ? caption.slice(0, 50) : undefined}
        onClose={() => setIsReportOpen(false)}
      />
    </article>
  );
}
