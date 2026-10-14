"use client";

import React from "react";
import type { FeedMode } from "@/lib/recommendation/scorer";

interface FeedModeSelectorProps {
  currentMode: FeedMode;
  onSelectMode: (mode: FeedMode) => void;
  disabled?: boolean;
}

interface ModeMeta {
  id: FeedMode;
  title: string;
  badge: string;
  description: string;
}

const MODES: ModeMeta[] = [
  {
    id: "my-mix",
    title: "My Mix",
    badge: "Interest Weighted",
    description: "Ranked by your selected interest weights and category synergies.",
  },
  {
    id: "focus",
    title: "Focus",
    badge: "Learning First",
    description: "High-priority learning, educational, and professional content only.",
  },
  {
    id: "following",
    title: "Following",
    badge: "Chronological",
    description: "Reverse-chronological posts from creators you follow. Unranked.",
  },
  {
    id: "explore",
    title: "Explore",
    badge: "Discovery",
    description: "Perspectives and novel topics outside your primary bubble.",
  },
  {
    id: "quiet",
    title: "Quiet Mode",
    badge: "Low Stimulus",
    description: "Calm, chronological browsing with minimal algorithmic scoring.",
  },
];

export function FeedModeSelector({
  currentMode,
  onSelectMode,
  disabled = false,
}: FeedModeSelectorProps) {
  const currentMeta = MODES.find((m) => m.id === currentMode) || MODES[0];

  return (
    <div className="flex flex-col gap-3">
      {/* Scrollable mode bar */}
      <div
        role="tablist"
        aria-label="Feed Modes"
        className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[var(--border)] no-scrollbar"
      >
        {MODES.map((mode) => {
          const isActive = currentMode === mode.id;
          return (
            <button
              key={mode.id}
              role="tab"
              aria-selected={isActive}
              disabled={disabled}
              onClick={() => onSelectMode(mode.id)}
              className={`px-3 py-2 rounded-[var(--radius-sm)] text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                isActive
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm font-semibold"
                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] border border-[var(--border)]"
              }`}
            >
              <span>{mode.title}</span>
              <span
                className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-[var(--surface)] text-[var(--foreground-muted)]"
                }`}
              >
                {mode.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active mode description banner */}
      <div className="flex items-center justify-between px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--surface-muted)] border border-[var(--border-subtle)] text-xs text-[var(--foreground-secondary)]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
          <span>{currentMeta.description}</span>
        </div>
      </div>
    </div>
  );
}
