"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCommunityAction } from "@/app/actions/communities";
import type { CommunityVisibility } from "@/lib/communities/types";

interface CreateCommunityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateCommunityModal({ isOpen, onClose }: CreateCommunityModalProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("public");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    // Auto-generate suggested slug if user hasn't explicitly customized slug
    const generated = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setSlug(generated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await createCommunityAction({
          name,
          slug,
          description: description || null,
          visibility,
          category: category || null,
        });

        if (res.success && res.data) {
          onClose();
          router.push(`/communities/${res.data.slug}`);
          router.refresh();
        } else {
          setError(res.message || "Failed to create community.");
        }
      } catch {
        setError("Unable to create community. Please check your inputs.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-community-title"
        className="w-full max-w-lg rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 id="create-community-title" className="text-lg font-bold text-[var(--foreground)]">
            Create a Community
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)] p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="comm-name" className="block text-xs font-semibold text-[var(--foreground)] mb-1">
              Community Name
            </label>
            <input
              id="comm-name"
              type="text"
              required
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Distributed Systems Group"
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>

          <div>
            <label htmlFor="comm-slug" className="block text-xs font-semibold text-[var(--foreground)] mb-1">
              Slug Identifier
            </label>
            <div className="flex items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] overflow-hidden">
              <span className="px-3 py-2 text-xs font-mono text-[var(--foreground-muted)] bg-[var(--surface-muted)] border-r border-[var(--border)]">
                c/
              </span>
              <input
                id="comm-slug"
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="distributed-systems"
                className="w-full px-3 py-2 text-sm bg-transparent text-[var(--foreground)] focus:outline-none font-mono"
              />
            </div>
            <p className="text-[11px] text-[var(--foreground-muted)] mt-1">
              Only lowercase letters, numbers, and hyphens.
            </p>
          </div>

          <div>
            <label htmlFor="comm-desc" className="block text-xs font-semibold text-[var(--foreground)] mb-1">
              Description (Optional)
            </label>
            <textarea
              id="comm-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is the mission or focus of this space?"
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="comm-vis" className="block text-xs font-semibold text-[var(--foreground)] mb-1">
                Visibility
              </label>
              <select
                id="comm-vis"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as CommunityVisibility)}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none"
              >
                <option value="public">Public (Open join)</option>
                <option value="private">Private (Approval needed)</option>
              </select>
            </div>

            <div>
              <label htmlFor="comm-cat" className="block text-xs font-semibold text-[var(--foreground)] mb-1">
                Category (Optional)
              </label>
              <input
                id="comm-cat"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. technology-science"
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !name.trim() || !slug.trim()}
              className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create Community"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
