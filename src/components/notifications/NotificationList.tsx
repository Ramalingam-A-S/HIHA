"use client";

import React, { useEffect, useState, useTransition } from "react";
import {
  getNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/app/actions/notifications";
import type { NotificationWithActor } from "@/lib/notifications/types";
import { NOTIFICATION_LABELS } from "@/lib/notifications/types";

export function NotificationList() {
  const [items, setItems] = useState<NotificationWithActor[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(false);

    getNotificationsAction({ page: 1, pageSize: 20 }).then((res) => {
      if (!mounted) return;
      if (res.success && res.data) {
        setItems(res.data.items);
        setHasMore(res.data.hasMore);
        setUnreadCount(res.data.unreadCount);
        setPage(1);
      } else {
        setError(true);
      }
      setLoading(false);
    }).catch(() => {
      if (mounted) { setError(true); setLoading(false); }
    });

    return () => { mounted = false; };
  }, []);

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    startTransition(async () => {
      try {
        const next = page + 1;
        const res = await getNotificationsAction({ page: next, pageSize: 20 });
        if (res.success && res.data) {
          setItems((prev) => [...prev, ...res.data!.items]);
          setPage(next);
          setHasMore(res.data.hasMore);
        }
      } catch { /* silent */ } finally {
        setLoadingMore(false);
      }
    });
  };

  const handleMarkOne = (id: string) => {
    startTransition(async () => {
      const res = await markNotificationReadAction(id);
      if (res.success) {
        setItems((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, read_at: new Date().toISOString() } : n
          )
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    });
  };

  const handleMarkAll = () => {
    startTransition(async () => {
      const res = await markAllNotificationsReadAction();
      if (res.success) {
        const now = new Date().toISOString();
        setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
        setUnreadCount(0);
      }
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Notifications
          </h1>
          {unreadCount > 0 && (
            <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
              {unreadCount} unread
            </p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={isPending}
            className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* States */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] animate-pulse flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-[var(--surface-muted)] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="w-48 h-3 rounded bg-[var(--surface-muted)]" />
                <div className="w-24 h-2 rounded bg-[var(--surface-muted)]" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-6 rounded-[var(--radius-sm)] bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-center space-y-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Something went wrong loading notifications. Please refresh.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-10 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] text-center space-y-2">
          <div className="w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mx-auto text-sm text-[var(--foreground-muted)]">
            ✦
          </div>
          <p className="text-sm font-semibold text-[var(--foreground)]">No notifications yet</p>
          <p className="text-xs text-[var(--foreground-muted)]">
            Follow requests and relationship updates will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const isUnread = !n.read_at;
            const actorName =
              n.actor?.display_name || n.actor?.username || "Someone";
            const label =
              NOTIFICATION_LABELS[n.type] ?? n.type.replace(/_/g, " ");
            const timeAgo = new Date(n.created_at).toLocaleDateString(
              undefined,
              { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
            );

            return (
              <div
                key={n.id}
                className={`p-4 rounded-[var(--radius-sm)] border flex items-start gap-3 transition-colors ${
                  isUnread
                    ? "bg-[var(--surface)] border-[var(--accent)]/30 shadow-xs"
                    : "bg-[var(--surface-muted)] border-[var(--border)]"
                }`}
              >
                {/* Actor avatar */}
                <div className="w-9 h-9 rounded-full bg-[var(--surface-muted)] border border-[var(--border)] flex items-center justify-center font-bold text-xs text-[var(--foreground)] uppercase shrink-0">
                  {actorName.charAt(0)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--foreground)] leading-snug">
                    <span className="font-semibold">{actorName}</span>{" "}
                    {label}
                  </p>
                  <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
                    {timeAgo}
                  </p>
                </div>

                {/* Unread indicator + mark-read action */}
                {isUnread && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent)]"
                      aria-label="Unread"
                    />
                    <button
                      type="button"
                      onClick={() => handleMarkOne(n.id)}
                      disabled={isPending}
                      className="text-[10px] text-[var(--foreground-muted)] hover:text-[var(--foreground)] disabled:opacity-50"
                      aria-label="Mark as read"
                    >
                      ✓
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {hasMore && (
            <div className="pt-4 text-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore || isPending}
                className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
