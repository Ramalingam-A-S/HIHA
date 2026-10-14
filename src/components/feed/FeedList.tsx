"use client";

import React, { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { getFeedAction } from "@/app/actions/feed";
import { FeedModeSelector } from "./FeedModeSelector";
import { FeedCard } from "./FeedCard";
import type { FeedItem } from "@/lib/feed/types";
import type { FeedMode } from "@/lib/recommendation/scorer";

export function FeedList() {
  const [mode, setMode] = useState<FeedMode>("my-mix");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<boolean>(false);
  const [retryKey, setRetryKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Load feed when mode or retryKey changes
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(false);
    setPage(1);

    async function loadInitialFeed() {
      try {
        const res = await getFeedAction({ mode, page: 1, pageSize: 15 });
        if (!isMounted) return;

        if (res.success && res.data) {
          setItems(res.data.items);
          setHasMore(res.data.hasMore);
        } else {
          setError(true);
        }
      } catch {
        if (isMounted) setError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadInitialFeed();
    return () => {
      isMounted = false;
    };
  }, [mode, retryKey]);

  // Load more pages
  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);

    startTransition(async () => {
      try {
        const nextPage = page + 1;
        const res = await getFeedAction({ mode, page: nextPage, pageSize: 15 });
        if (res.success && res.data) {
          setItems((prev) => [...prev, ...res.data!.items]);
          setPage(nextPage);
          setHasMore(res.data.hasMore);
        }
      } catch {
        setError(true);
      } finally {
        setLoadingMore(false);
      }
    });
  };

  const emptyMessages: Record<FeedMode, { title: string; desc: string; actionHref?: string; actionLabel?: string }> = {
    "my-mix": {
      title: "No Posts in Your Mix Yet",
      desc: "Posts matching your selected interests will appear here. You can tune your topics or be the first to publish.",
      actionHref: "/interests",
      actionLabel: "Tune Interests",
    },
    focus: {
      title: "No Focus Content Found",
      desc: "No published posts match your high-priority learning and educational domains at this moment.",
      actionHref: "/interests",
      actionLabel: "Adjust Focus Interests",
    },
    following: {
      title: "You Aren't Following Any Creators Yet",
      desc: "Posts from creators you actively follow will be listed here in chronological order.",
      actionHref: "/network",
      actionLabel: "Discover Creators",
    },
    explore: {
      title: "Nothing to Explore Right Now",
      desc: "Discovery recommendations will populate as new topics and creators join the platform.",
      actionHref: "/create",
      actionLabel: "Create a Post",
    },
    quiet: {
      title: "Quiet Feed is Empty",
      desc: "No published content found for your minimal baseline view.",
      actionHref: "/create",
      actionLabel: "Create a Post",
    },
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
      {/* Feed Controls Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
              Personalized Feed
            </h1>
            <p className="text-xs text-[var(--foreground-muted)]">
              Transparent, deterministic content delivery powered by your preferences.
            </p>
          </div>
          <Link
            href="/create"
            className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 transition-opacity shrink-0"
          >
            Create Post
          </Link>
        </div>

        {/* Mode Selector */}
        <FeedModeSelector
          currentMode={mode}
          onSelectMode={setMode}
          disabled={loading || isPending}
        />
      </div>

      {/* Feed Stream */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="p-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] animate-pulse space-y-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[var(--surface-muted)]" />
                <div className="space-y-1.5 flex-1">
                  <div className="w-24 h-3 rounded bg-[var(--surface-muted)]" />
                  <div className="w-16 h-2 rounded bg-[var(--surface-muted)]" />
                </div>
              </div>
              <div className="w-full h-12 rounded bg-[var(--surface-muted)]" />
              <div className="w-1/3 h-4 rounded bg-[var(--surface-muted)]" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-6 rounded-[var(--radius-sm)] bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-center space-y-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Something went wrong loading your feed. Please try again.
          </p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
          >
            Retry Feed
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mx-auto text-[var(--foreground-muted)] text-sm">
            ✦
          </div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            {emptyMessages[mode].title}
          </h2>
          <p className="text-xs text-[var(--foreground-muted)] max-w-sm mx-auto leading-relaxed">
            {emptyMessages[mode].desc}
          </p>
          {emptyMessages[mode].actionHref && (
            <div className="pt-2">
              <Link
                href={emptyMessages[mode].actionHref!}
                className="inline-flex px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
              >
                {emptyMessages[mode].actionLabel}
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}

          {/* Load More Button */}
          {hasMore && (
            <div className="pt-4 text-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore || isPending}
                className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors disabled:opacity-50"
              >
                {loadingMore ? "Loading more posts..." : "Load More Posts"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
