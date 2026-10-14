import React from "react";
import Link from "next/link";

interface FeedModeCard {
  readonly title: string;
  readonly badge: string;
  readonly description: string;
}

const FEED_MODES: readonly FeedModeCard[] = [
  {
    title: "My Mix",
    badge: "User Interest Driven",
    description:
      "A personalized feed balanced strictly by interests you choose, combine, and reprioritize at any time.",
  },
  {
    title: "Focus",
    badge: "Distraction Free",
    description:
      "Curated educational, professional, and deep-learning content with social noise minimized.",
  },
  {
    title: "Following",
    badge: "Chronological",
    description:
      "Unranked, chronological posts from accounts you actively choose to follow. No algorithmic insertion.",
  },
  {
    title: "Explore",
    badge: "Transparent Discovery",
    description:
      "Deliberate discovery of unfamiliar topics and diverse perspectives outside your immediate bubble.",
  },
  {
    title: "Quiet Mode",
    badge: "Low Stimulus",
    description:
      "Reduced distractions, suppressed vanity counters, and zero manipulative engagement loops.",
  },
];

const PLATFORM_PILLARS = [
  {
    title: "Explainable Discovery",
    description:
      "Every feed item clearly shows why it appeared. Users can adjust interest weights, mark topics irrelevant, or reset recommendations at will.",
  },
  {
    title: "Digital Well-Being & Privacy",
    description:
      "Strict server-side authorization, zero behavioral tracking, no dark patterns, and age-appropriate privacy defaults from day one.",
  },
  {
    title: "Collaborative Creation",
    description:
      "Shared project workspaces with contribution queues, clear licensing, transparent attribution, and creator consent.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-12">
      {/* Welcome & Product Vision Section */}
      <section aria-labelledby="platform-vision-heading" className="space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--surface-muted)] border border-[var(--border)] text-xs font-mono text-[var(--foreground-secondary)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
          <span>Milestone 1.1 Foundation Active</span>
        </div>

        <h1
          id="platform-vision-heading"
          className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[var(--foreground)]"
        >
          Responsible, Interest-Driven Social Media
        </h1>

        <p className="text-base sm:text-lg text-[var(--foreground-secondary)] max-w-3xl leading-relaxed">
          Users control their feed. Users choose their connections. Communities
          shape their own content. A functional platform designed for intentional
          discovery, collaboration, and digital well-being.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href="/feed"
            className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Open Feed
          </Link>
          <Link
            href="/interests"
            className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            Tune Interests
          </Link>
          <Link
            href="/create"
            className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            Create Post
          </Link>
        </div>
      </section>

      {/* User-Controlled Discovery Blueprint */}
      <section
        aria-labelledby="feed-modes-heading"
        className="space-y-6 pt-4 border-t border-[var(--border)]"
      >
        <div className="space-y-1">
          <h2
            id="feed-modes-heading"
            className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--foreground)]"
          >
            User-Controlled Feed Modes
          </h2>
          <p className="text-sm text-[var(--foreground-muted)]">
            Architectural feed modes scheduled for implementation in Milestone 2.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEED_MODES.map((mode) => (
            <div
              key={mode.title}
              className="p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-base text-[var(--foreground)]">
                    {mode.title}
                  </h3>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--surface-muted)] text-[var(--foreground-secondary)] border border-[var(--border)]">
                    {mode.badge}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--foreground-secondary)]">
                  {mode.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Core Architectural Pillars */}
      <section
        aria-labelledby="pillars-heading"
        className="space-y-6 pt-4 border-t border-[var(--border)]"
      >
        <div className="space-y-1">
          <h2
            id="pillars-heading"
            className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--foreground)]"
          >
            Platform Principles
          </h2>
          <p className="text-sm text-[var(--foreground-muted)]">
            Non-negotiable architectural tenets guiding all implementations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLATFORM_PILLARS.map((pillar) => (
            <div
              key={pillar.title}
              className="p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-2"
            >
              <h3 className="font-semibold text-sm text-[var(--foreground)]">
                {pillar.title}
              </h3>
              <p className="text-xs leading-relaxed text-[var(--foreground-secondary)]">
                {pillar.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Foundation Status & Roadmap Checkpoint */}
      <section
        aria-labelledby="status-heading"
        className="p-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)] space-y-4"
      >
        <h2
          id="status-heading"
          className="text-base font-semibold text-[var(--foreground)]"
        >
          System Foundation Checkpoint (Milestone 1.1)
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <dt className="text-[var(--foreground-muted)] font-medium">
              Framework & Runtime
            </dt>
            <dd className="mt-1 font-mono font-medium text-[var(--foreground)]">
              Next.js 15.5 App Router + React 19
            </dd>
          </div>
          <div>
            <dt className="text-[var(--foreground-muted)] font-medium">
              Design System
            </dt>
            <dd className="mt-1 font-mono font-medium text-[var(--foreground)]">
              Tailwind CSS v4 + Semantic CSS Tokens
            </dd>
          </div>
          <div>
            <dt className="text-[var(--foreground-muted)] font-medium">
              Environment Safety
            </dt>
            <dd className="mt-1 font-mono font-medium text-[var(--foreground)]">
              Zod Server/Client Separation (Zero Leaks)
            </dd>
          </div>
          <div>
            <dt className="text-[var(--foreground-muted)] font-medium">
              Test Harness
            </dt>
            <dd className="mt-1 font-mono font-medium text-[var(--foreground)]">
              Vitest Suite (15 passing tests)
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
