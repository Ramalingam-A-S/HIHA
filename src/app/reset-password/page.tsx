"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { resetPasswordAction } from "@/app/actions/auth";

export default function ResetPasswordPage() {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const result = await resetPasswordAction({ email });
      setFeedback(
        result.message ||
          "If an account exists, a reset link has been dispatched."
      );
    });
  };

  return (
    <div className="max-w-md mx-auto py-8">
      <div className="p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Reset Password
          </h1>
          <p className="text-xs text-[var(--foreground-muted)]">
            Enter your email to receive a secure recovery link.
          </p>
        </div>

        {feedback && (
          <div
            role="status"
            className="p-4 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] leading-relaxed"
          >
            {feedback}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="block text-xs font-medium text-[var(--foreground)]"
            >
              Account Email
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

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 px-4 text-sm font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPending ? "Sending link..." : "Send Reset Link"}
          </button>
        </form>

        <div className="pt-4 border-t border-[var(--border)] text-center text-xs text-[var(--foreground-muted)]">
          Remember your password?{" "}
          <Link
            href="/login"
            className="text-[var(--accent)] font-medium hover:underline"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
