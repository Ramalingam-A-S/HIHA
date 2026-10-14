import React from "react";
import Link from "next/link";
import { NotificationBadge } from "@/components/notifications/NotificationBadge";

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly statusBadge: string;
  readonly description: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    label: "Discover",
    href: "#",
    statusBadge: "Milestone 2.1",
    description: "User-controlled feed modes & interests",
  },
  {
    label: "Communities",
    href: "#",
    statusBadge: "Milestone 3.3",
    description: "Topic-based spaces & moderation",
  },
  {
    label: "Create",
    href: "#",
    statusBadge: "Milestone 2.3",
    description: "Text, media & collaborative projects",
  },
  {
    label: "Settings",
    href: "#",
    statusBadge: "Milestone 4.2",
    description: "Privacy, feed rules & account control",
  },
];

export function NavShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--background)] text-[var(--foreground)]">
      {/* Desktop & Tablet Sidebar */}
      <aside
        aria-label="Primary Platform Navigation"
        className="hidden md:flex md:w-64 lg:w-72 flex-col justify-between p-6 border-r border-[var(--border)] bg-[var(--surface)] shrink-0"
      >
        <div className="flex flex-col gap-8">
          {/* Wordmark */}
          <Link
            href="/"
            className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-[var(--radius-sm)]"
          >
            <div
              className="w-8 h-8 rounded-md bg-[var(--accent)] flex items-center justify-center text-[var(--accent-contrast)] font-bold text-sm tracking-wide group-hover:opacity-90 transition-opacity"
              aria-hidden="true"
            >
              H
            </div>
            <div>
              <span className="font-semibold tracking-tight text-lg block">
                HIHA
              </span>
              <span className="text-xs text-[var(--foreground-muted)] block">
                Responsible Social Platform
              </span>
            </div>
          </Link>

          {/* Account & Profile Navigation */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--foreground-muted)]">
              Account
            </p>
            <div className="flex flex-col gap-1">
              <Link
                href="/feed"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Feed</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/notifications"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  Notifications
                  <NotificationBadge />
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/profile"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>My Profile</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]">
                  Active
                </span>
              </Link>
              <Link
                href="/interests"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Feed Interests</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/network"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Network & Safety</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/create"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Create Post</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/communities"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Communities</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/collaborate"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Collaborate</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/moderation"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Trust & Safety</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-850">
                  Queue
                </span>
              </Link>
              <Link
                href="/settings"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Privacy &amp; Data</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-850">
                  Active
                </span>
              </Link>
              <Link
                href="/policies"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-sm font-medium transition-colors"
              >
                <span>Platform Policies</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]">
                  v1.4
                </span>
              </Link>
              <Link
                href="/login"
                className="flex items-center justify-between p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-muted)] text-xs text-[var(--foreground-secondary)] transition-colors"
              >
                <span>Sign In / Switch</span>
              </Link>
            </div>
          </div>

          {/* Planned Modules Navigation */}
          <nav aria-label="Main Navigation">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
              Platform Modules
            </p>
            <ul className="flex flex-col gap-1.5" role="list">
              {NAV_ITEMS.map((item) => (
                <li key={item.label}>
                  <div
                    tabIndex={0}
                    aria-label={`${item.label} (${item.statusBadge})`}
                    className="group flex flex-col p-2.5 rounded-[var(--radius-sm)] border border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-muted)] transition-colors cursor-default"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-[var(--foreground)]">
                        {item.label}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]">
                        {item.statusBadge}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--foreground-muted)] mt-0.5">
                      {item.description}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Foundation Status Footer */}
        <div className="pt-6 border-t border-[var(--border-subtle)] text-xs text-[var(--foreground-muted)] flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-medium text-[var(--foreground)]">
              Milestone 4.4 — Privacy &amp; Safety
            </span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Postgres RLS + Age-Aware Safety + Data Controls active.
          </p>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header
        aria-label="Mobile Navigation Bar"
        className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-20"
      >
        <Link href="/" className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-md bg-[var(--accent)] flex items-center justify-center text-[var(--accent-contrast)] font-bold text-xs"
            aria-hidden="true"
          >
            H
          </div>
          <span className="font-semibold text-base">HIHA</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="text-xs font-medium px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
          >
            Settings
          </Link>
          <Link
            href="/profile"
            className="text-xs font-medium px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
          >
            Profile
          </Link>
          <Link
            href="/login"
            className="text-xs font-medium px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)]"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <main id="main-content" className="flex-1 p-6 md:p-10 lg:p-12 max-w-5xl">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav
          aria-label="Mobile Tab Navigation"
          className="md:hidden border-t border-[var(--border)] bg-[var(--surface)] px-2 py-2 flex justify-around sticky bottom-0 z-20"
        >
          <Link href="/" className="flex flex-col items-center p-1 text-center">
            <span className="text-xs font-medium text-[var(--foreground)]">
              Home
            </span>
          </Link>
          <Link
            href="/feed"
            className="flex flex-col items-center p-1 text-center"
          >
            <span className="text-xs font-medium text-[var(--foreground)]">
              Feed
            </span>
          </Link>
          <Link
            href="/notifications"
            className="flex flex-col items-center p-1 text-center relative"
          >
            <span className="text-xs font-medium text-[var(--foreground)] flex items-center gap-1">
              Alerts
              <NotificationBadge />
            </span>
          </Link>
          <Link
            href="/interests"
            className="flex flex-col items-center p-1 text-center"
          >
            <span className="text-xs font-medium text-[var(--foreground)]">
              Interests
            </span>
          </Link>
          <Link
            href="/network"
            className="flex flex-col items-center p-1 text-center"
          >
            <span className="text-xs font-medium text-[var(--foreground)]">
              Network
            </span>
          </Link>
          <Link
            href="/create"
            className="flex flex-col items-center p-1 text-center"
          >
            <span className="text-xs font-medium text-[var(--foreground)]">
              Create
            </span>
          </Link>
          <Link
            href="/communities"
            className="flex flex-col items-center p-1 text-center"
          >
            <span className="text-xs font-medium text-[var(--foreground)]">
              Hubs
            </span>
          </Link>
          <Link
            href="/profile"
            className="flex flex-col items-center p-1 text-center"
          >
            <span className="text-xs font-medium text-[var(--foreground)]">
              Profile
            </span>
          </Link>
          {NAV_ITEMS.slice(0, 1).map((item) => (
            <div
              key={item.label}
              className="flex flex-col items-center p-1 text-center opacity-60"
            >
              <span className="text-xs font-medium text-[var(--foreground)]">
                {item.label}
              </span>
              <span className="text-[9px] text-[var(--foreground-muted)]">
                {item.statusBadge}
              </span>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
