"use client";

import React, { useState, useTransition } from "react";
import {
  respondToFollowRequestAction,
  type IncomingRequestItem,
} from "@/app/actions/relationships";

interface IncomingRequestsListProps {
  initialRequests: IncomingRequestItem[];
}

export function IncomingRequestsList({
  initialRequests,
}: IncomingRequestsListProps) {
  const [requests, setRequests] = useState<IncomingRequestItem[]>(initialRequests);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleResponse = (followId: string, action: "accept" | "reject") => {
    setFeedback(null);
    startTransition(async () => {
      const res = await respondToFollowRequestAction({ followId, action });
      if (res.success) {
        setRequests((prev) => prev.filter((r) => r.id !== followId));
        setFeedback(res.message || "Request updated.");
      } else {
        setFeedback(res.message || "Failed to update request.");
      }
    });
  };

  if (requests.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[var(--foreground-muted)] rounded-[var(--radius-md)] border border-dashed border-[var(--border)]">
        No pending follow requests.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div
          role="status"
          className="p-3 text-xs rounded-[var(--radius-sm)] border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
        >
          {feedback}
        </div>
      )}

      <div className="divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {requests.map((req) => (
          <div
            key={req.id}
            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[var(--foreground)]">
                  {req.follower?.display_name || "User"}
                </span>
                <span className="text-xs font-mono text-[var(--foreground-muted)]">
                  @{req.follower?.username || "unknown"}
                </span>
              </div>
              {req.follower?.bio && (
                <p className="text-xs text-[var(--foreground-secondary)] mt-0.5 line-clamp-1">
                  {req.follower.bio}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleResponse(req.id, "accept")}
                className="py-1 px-3 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleResponse(req.id, "reject")}
                className="py-1 px-3 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-secondary)] hover:text-red-600 disabled:opacity-50 transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
