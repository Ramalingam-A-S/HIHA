"use client";

import React, { useState, useEffect, useTransition } from "react";
import { getShareablePostsAction, shareToCommunityAction } from "@/app/actions/community-posts";
import type { Post } from "@/lib/supabase/types";

interface ShareToCommunityModalProps {
  isOpen: boolean;
  communityId: string;
  communityName: string;
  onClose: () => void;
  onPostShared: () => void;
}

export function ShareToCommunityModal({
  isOpen,
  communityId,
  communityName,
  onClose,
  onPostShared,
}: ShareToCommunityModalProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isOpen) {
      setSelectedPostId(null);
      setError(null);
      return;
    }

    setLoading(true);
    getShareablePostsAction({ communityId })
      .then((res) => {
        if (res.success && res.data) {
          setPosts(res.data.items);
          if (res.data.items.length > 0) {
            setSelectedPostId(res.data.items[0].id);
          }
        } else {
          setError(res.message || "Failed to load posts.");
        }
      })
      .catch(() => setError("Unable to load posts."))
      .finally(() => setLoading(false));
  }, [isOpen, communityId]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPostId) {
      setError("Please select a post to share.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await shareToCommunityAction({
          communityId,
          postId: selectedPostId,
        });

        if (res.success) {
          onPostShared();
          onClose();
        } else {
          setError(res.message || "Failed to share post.");
        }
      } catch {
        setError("Unable to share post to community.");
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
          <h2 id="share-modal-title" className="text-base font-semibold text-[var(--foreground)]">
            Share to {communityName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-[var(--foreground-muted)] hover:text-[var(--foreground)] text-sm px-2 py-1"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--foreground-muted)]">
            Loading your published posts…
          </div>
        ) : posts.length === 0 ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-xs text-[var(--foreground-muted)]">
              You do not have any published posts eligible to share.
            </p>
            <p className="text-[11px] text-[var(--foreground-muted)]">
              Create and publish a post first, or check if all your existing posts are already in this space.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 flex-1 overflow-y-auto">
            <p className="text-xs text-[var(--foreground-muted)]">
              Select one of your published posts to cross-post into this community:
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {posts.map((p) => {
                const isSelected = selectedPostId === p.id;
                return (
                  <label
                    key={p.id}
                    className={`block p-3 rounded border text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? "border-[var(--accent)] bg-[var(--surface-muted)]"
                        : "border-[var(--border)] hover:bg-[var(--surface-muted)]/50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="postSelection"
                        value={p.id}
                        checked={isSelected}
                        onChange={() => setSelectedPostId(p.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[var(--foreground)] font-medium line-clamp-2">
                          {p.caption || "[Media post without caption]"}
                        </p>
                        <span className="text-[10px] text-[var(--foreground-muted)] mt-1 block">
                          Format: {p.content_type} • {new Date(p.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending || !selectedPostId}
                className="px-4 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Sharing…" : "Share Post"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
