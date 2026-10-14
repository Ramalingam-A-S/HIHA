"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import type { CommunityWithDetails } from "@/lib/communities/types";
import { joinCommunityAction, leaveCommunityAction } from "@/app/actions/communities";

interface CommunityCardProps {
  community: CommunityWithDetails;
}

export function CommunityCard({ community }: CommunityCardProps) {
  const [membership, setMembership] = useState(community.viewerMembership);
  const [memberCount, setMemberCount] = useState(community.memberCount);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isOwner = membership?.role === "owner";
  const isActive = membership?.status === "active";
  const isPendingRequest = membership?.status === "pending";

  const handleJoin = () => {
    if (isPending) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await joinCommunityAction(community.id);
        if (res.success && res.data) {
          if (res.data.status === "active") {
            setMembership({ role: "member", status: "active" });
            setMemberCount((c) => c + 1);
          } else {
            setMembership({ role: "member", status: "pending" });
          }
        } else {
          setActionError("Unable to join. Access may be restricted.");
        }
      } catch {
        setActionError("Unable to join. Access may be restricted.");
      }
    });
  };

  const handleLeave = () => {
    if (isPending || isOwner) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await leaveCommunityAction(community.id);
        if (res.success) {
          setMembership(null);
          setMemberCount((c) => Math.max(1, c - 1));
        } else {
          setActionError("Unable to leave community.");
        }
      } catch {
        setActionError("Unable to leave community.");
      }
    });
  };

  return (
    <article className="p-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] shadow-xs flex flex-col justify-between gap-4">
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link
              href={`/communities/${community.slug}`}
              className="text-base font-semibold tracking-tight text-[var(--foreground)] hover:text-[var(--accent)] transition-colors"
            >
              {community.name}
            </Link>
            <p className="text-xs font-mono text-[var(--foreground-muted)]">
              c/{community.slug}
            </p>
          </div>
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

        {community.description && (
          <p className="text-xs text-[var(--foreground-secondary)] line-clamp-2 leading-relaxed">
            {community.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-[var(--foreground-muted)]">
          <span>{memberCount} member{memberCount === 1 ? "" : "s"}</span>
          {community.category && (
            <>
              <span>•</span>
              <span className="capitalize">{community.category.replace(/-/g, " ")}</span>
            </>
          )}
        </div>
      </div>

      <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
        {actionError ? (
          <span className="text-[11px] text-red-600 dark:text-red-400 font-medium" role="alert">
            {actionError}
          </span>
        ) : <div />}

        <div className="flex items-center gap-2 ml-auto">
          <Link
            href={`/communities/${community.slug}`}
            className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            View
          </Link>

          {isOwner ? (
            <span className="text-[11px] font-mono font-medium px-2.5 py-1 rounded bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]">
              Owner
            </span>
          ) : isActive ? (
            <button
              type="button"
              onClick={handleLeave}
              disabled={isPending}
              className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-xs font-medium text-[var(--foreground-muted)] hover:text-red-600 hover:border-red-300 transition-colors disabled:opacity-50"
            >
              Leave
            </button>
          ) : isPendingRequest ? (
            <span className="text-[11px] font-medium px-2.5 py-1 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
              Requested
            </span>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={isPending}
              className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {community.visibility === "public" ? "Join" : "Request Join"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
