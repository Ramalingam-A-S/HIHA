"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginAction } from "@/app/actions/auth";

export default function LoginPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await loginAction({ email, password });
      if (!result.success) {
        setError(result.message || "Failed to sign in");
      } else {
        router.push(result.data?.redirectTo || "/profile");
        router.refresh();
      }
    });
  };

  return (
    <div className="max-w-md mx-auto py-8">
      <div className="p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Sign in to HIHA
          </h1>
          <p className="text-xs text-[var(--foreground-muted)]">
            Access your user-controlled feeds and profile.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 text-xs rounded-[var(--radius-sm)] border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="block text-xs font-medium text-[var(--foreground)]"
            >
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-[var(--foreground)]"
              >
                Password
              </label>
              <Link
                href="/reset-password"
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 px-4 text-sm font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPending ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="pt-4 border-t border-[var(--border)] text-center text-xs text-[var(--foreground-muted)]">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-[var(--accent)] font-medium hover:underline"
          >
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
