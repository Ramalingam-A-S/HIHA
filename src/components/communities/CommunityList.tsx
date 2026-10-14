"use client";

import React, { useEffect, useState } from "react";
import type { CommunityWithDetails } from "@/lib/communities/types";
import { getCommunitiesAction } from "@/app/actions/communities";
import { CommunityCard } from "./CommunityCard";
import { CreateCommunityModal } from "./CreateCommunityModal";

export function CommunityList() {
  const [communities, setCommunities] = useState<CommunityWithDetails[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(false);

    getCommunitiesAction({ search: search.trim() || null })
      .then((res) => {
        if (!mounted) return;
        if (res.success && res.data) {
          setCommunities(res.data.items);
        } else {
          setError(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [search]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Communities
          </h1>
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
            Topic-based spaces, discussion circles, and collaborative groups.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          + Create Community
        </button>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search communities by name or description…"
          className="w-full px-4 py-2.5 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-3 top-2.5 text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
          >
            Clear
          </button>
        )}
      </div>

      {/* Community Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="p-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] animate-pulse space-y-3"
            >
              <div className="h-4 w-32 bg-[var(--surface-muted)] rounded" />
              <div className="h-3 w-48 bg-[var(--surface-muted)] rounded" />
              <div className="h-10 bg-[var(--surface-muted)] rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 rounded-[var(--radius-sm)] bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-center">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Unable to load communities. Please refresh or try again later.
          </p>
        </div>
      ) : communities.length === 0 ? (
        <div className="p-12 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mx-auto text-sm text-[var(--foreground-muted)]">
            ◈
          </div>
          <p className="text-sm font-semibold text-[var(--foreground)]">No communities found</p>
          <p className="text-xs text-[var(--foreground-muted)] max-w-sm mx-auto">
            {search
              ? "No spaces match your search criteria. Try a different query or start a new community."
              : "No public communities yet. Be the first to establish a topic space!"}
          </p>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="mt-2 px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            Create the first community
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {communities.map((c) => (
            <CommunityCard key={c.id} community={c} />
          ))}
        </div>
      )}

      {/* Creation Modal */}
      <CreateCommunityModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
