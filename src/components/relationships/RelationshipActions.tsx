"use client";

import React, { useState, useTransition } from "react";
import {
  followAction,
  unfollowAction,
  blockUserAction,
  unblockUserAction,
  muteUserAction,
  unmuteUserAction,
  type RelationshipState,
} from "@/app/actions/relationships";

interface RelationshipActionsProps {
  targetUserId: string;
  targetUsername: string;
  isTargetPrivate: boolean;
  initialState: RelationshipState;
}

export function RelationshipActions({
  targetUserId,
  targetUsername,
  isTargetPrivate,
  initialState,
}: RelationshipActionsProps) {
  const [state, setState] = useState<RelationshipState>(initialState);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleFollow = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await followAction(targetUserId);
      if (res.success && res.data) {
        if (res.data.status === "accepted") {
          setState((prev) => ({
            ...prev,
            isFollowing: true,
            isPendingOutgoing: false,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            isFollowing: false,
            isPendingOutgoing: true,
          }));
        }
        setFeedback({ type: "success", text: res.message || "Updated." });
      } else {
        setFeedback({ type: "error", text: res.message || "Failed to follow." });
      }
    });
  };

  const handleUnfollow = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await unfollowAction(targetUserId);
      if (res.success) {
        setState((prev) => ({
          ...prev,
          isFollowing: false,
          isPendingOutgoing: false,
        }));
        setFeedback({ type: "success", text: res.message || "Unfollowed." });
      } else {
        setFeedback({ type: "error", text: res.message || "Failed to unfollow." });
      }
    });
  };

  const handleBlockToggle = () => {
    if (
      !state.isBlockedByMe &&
      !window.confirm(
        `Block @${targetUsername}? This will immediately sever any follow relationship and prevent them from seeing your profile.`
      )
    ) {
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      if (state.isBlockedByMe) {
        const res = await unblockUserAction(targetUserId);
        if (res.success) {
          setState((prev) => ({ ...prev, isBlockedByMe: false }));
          setFeedback({ type: "success", text: `@${targetUsername} unblocked.` });
        } else {
          setFeedback({ type: "error", text: res.message || "Action failed." });
        }
      } else {
        const res = await blockUserAction(targetUserId);
        if (res.success) {
          setState((prev) => ({
            ...prev,
            isBlockedByMe: true,
            isFollowing: false,
            isPendingOutgoing: false,
            isFollower: false,
            isMuted: false,
          }));
          setFeedback({ type: "success", text: `@${targetUsername} blocked.` });
        } else {
          setFeedback({ type: "error", text: res.message || "Action failed." });
        }
      }
    });
  };

  const handleMuteToggle = () => {
    setFeedback(null);
    startTransition(async () => {
      if (state.isMuted) {
        const res = await unmuteUserAction(targetUserId);
        if (res.success) {
          setState((prev) => ({ ...prev, isMuted: false }));
          setFeedback({ type: "success", text: `@${targetUsername} unmuted.` });
        } else {
          setFeedback({ type: "error", text: res.message || "Action failed." });
        }
      } else {
        const res = await muteUserAction(targetUserId);
        if (res.success) {
          setState((prev) => ({ ...prev, isMuted: true }));
          setFeedback({
            type: "success",
            text: `@${targetUsername} muted. Their content will be suppressed quietly.`,
          });
        } else {
          setFeedback({ type: "error", text: res.message || "Action failed." });
        }
      }
    });
  };

  if (state.isBlockedByThem) {
    return (
      <span className="text-xs text-[var(--foreground-muted)] italic">
        Account unavailable
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      {feedback && (
        <span
          role="status"
          className={`text-[11px] px-2 py-0.5 rounded ${
            feedback.type === "success"
              ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40"
              : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40"
          }`}
        >
          {feedback.text}
        </span>
      )}

      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        {/* Blocked State */}
        {state.isBlockedByMe ? (
          <button
            type="button"
            disabled={isPending}
            onClick={handleBlockToggle}
            className="px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            {isPending ? "..." : "Unblock"}
          </button>
        ) : (
          <>
            {/* Follow / Pending / Unfollow Button */}
            {state.isFollowing ? (
              <button
                type="button"
                disabled={isPending}
                onClick={handleUnfollow}
                className="px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] hover:border-red-300 hover:text-red-600 transition-colors"
              >
                {isPending ? "..." : "Following"}
              </button>
            ) : state.isPendingOutgoing ? (
              <button
                type="button"
                disabled={isPending}
                onClick={handleUnfollow}
                className="px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 transition-colors"
                title="Click to cancel pending request"
              >
                {isPending ? "..." : "Requested (Cancel)"}
              </button>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={handleFollow}
                className="px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 transition-opacity"
              >
                {isPending
                  ? "..."
                  : isTargetPrivate
                  ? "Request"
                  : "Follow"}
              </button>
            )}

            {/* Mute Button */}
            <button
              type="button"
              disabled={isPending}
              onClick={handleMuteToggle}
              className={`px-2 py-1 text-xs rounded-[var(--radius-sm)] border transition-colors ${
                state.isMuted
                  ? "border-amber-300 dark:border-amber-800 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20"
                  : "border-[var(--border)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
              title={state.isMuted ? "Unmute creator" : "Quietly suppress in feed"}
            >
              {state.isMuted ? "Muted" : "Mute"}
            </button>

            {/* Block Button */}
            <button
              type="button"
              disabled={isPending}
              onClick={handleBlockToggle}
              className="px-2 py-1 text-xs text-[var(--foreground-muted)] hover:text-red-600 rounded-[var(--radius-sm)] border border-[var(--border)] transition-colors"
              title="Block account"
            >
              Block
            </button>
          </>
        )}
      </div>
    </div>
  );
}
