"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { signUpAction } from "@/app/actions/auth";

export default function SignUpPage() {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [minimumAgeAttested, setMinimumAgeAttested] = useState(false);
  const [ageSafetyMode, setAgeSafetyMode] = useState<"standard" | "teen_13_17">(
    "standard"
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSuccessMessage(null);

    startTransition(async () => {
      const result = await signUpAction({
        email,
        password,
        username,
        displayName,
        minimumAgeAttested,
        ageSafetyMode,
      });

      if (!result.success) {
        setError(result.message || "Failed to create account");
        if (result.errors) {
          setFieldErrors(result.errors);
        }
      } else {
        setSuccessMessage(
          result.message || "Account created! You can now log in."
        );
      }
    });
  };

  return (
    <div className="max-w-md mx-auto py-8">
      <div className="p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Create an Account
          </h1>
          <p className="text-xs text-[var(--foreground-muted)]">
            Join the responsible, interest-driven community.
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

        {successMessage && (
          <div
            role="alert"
            className="p-4 text-xs rounded-[var(--radius-sm)] border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 space-y-2"
          >
            <p className="font-semibold">{successMessage}</p>
            <p>
              Please proceed to{" "}
              <Link href="/login" className="underline font-bold">
                Sign In
              </Link>
              .
            </p>
          </div>
        )}

        {!successMessage && (
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
              {fieldErrors.email && (
                <p className="text-[11px] text-red-600 dark:text-red-400">
                  {fieldErrors.email[0]}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="block text-xs font-medium text-[var(--foreground)]"
              >
                Username
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm text-[var(--foreground-muted)]">
                  @
                </span>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  className="w-full pl-7 pr-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
                  placeholder="alex_creator"
                />
              </div>
              <p className="text-[11px] text-[var(--foreground-muted)]">
                3-30 characters, letters, numbers, and underscores only.
              </p>
              {fieldErrors.username && (
                <p className="text-[11px] text-red-600 dark:text-red-400">
                  {fieldErrors.username[0]}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="displayName"
                className="block text-xs font-medium text-[var(--foreground)]"
              >
                Display Name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
                placeholder="Alex Morgan"
              />
              {fieldErrors.displayName && (
                <p className="text-[11px] text-red-600 dark:text-red-400">
                  {fieldErrors.displayName[0]}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-[var(--foreground)]"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
                placeholder="Minimum 8 characters"
              />
              {fieldErrors.password && (
                <p className="text-[11px] text-red-600 dark:text-red-400">
                  {fieldErrors.password[0]}
                </p>
              )}
            </div>

            {/* Age-Aware Safety Experience Mode */}
            <div className="pt-2 border-t border-[var(--border)] space-y-2">
              <label
                htmlFor="ageSafetyMode"
                className="block text-xs font-medium text-[var(--foreground)]"
              >
                Age-Appropriate Safety Mode
              </label>
              <select
                id="ageSafetyMode"
                value={ageSafetyMode}
                onChange={(e) =>
                  setAgeSafetyMode(e.target.value as "standard" | "teen_13_17")
                }
                className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
              >
                <option value="standard">
                  Standard Adult Experience (18+)
                </option>
                <option value="teen_13_17">
                  Teen Protective Experience (Ages 13–17)
                </option>
              </select>
              <p className="text-[11px] text-[var(--foreground-muted)] leading-relaxed">
                {ageSafetyMode === "teen_13_17"
                  ? "Teen Protective Mode automatically enables a private profile, hides your account from public directory search, requires follower approval, and restricts posts to Followers Only or Private."
                  : "We minimize age-related data collection and never collect or store birth dates. You can enable Teen Protective Mode at any time in Privacy & Safety Settings."}
              </p>
            </div>

            {/* Minimum Age Self-Attestation */}
            <div className="space-y-1.5">
              <label className="flex items-start gap-2.5 p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={minimumAgeAttested}
                  onChange={(e) => setMinimumAgeAttested(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)]"
                />
                <span className="text-[11px] text-[var(--foreground-secondary)] leading-relaxed">
                  I confirm that I am at least <strong>13 years old</strong> (or
                  the minimum legal age required in my jurisdiction) and agree
                  to HIHA&apos;s{" "}
                  <Link
                    href="/policies"
                    className="underline text-[var(--foreground)] font-medium"
                  >
                    Privacy Policy, Terms of Use &amp; Community Guidelines
                  </Link>
                  .
                </span>
              </label>
              {fieldErrors.minimumAgeAttested && (
                <p className="text-[11px] text-red-600 dark:text-red-400">
                  {fieldErrors.minimumAgeAttested[0]}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 px-4 text-sm font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isPending ? "Creating account..." : "Create Account"}
            </button>
          </form>
        )}

        <div className="pt-4 border-t border-[var(--border)] text-center text-xs text-[var(--foreground-muted)] space-y-1">
          <div>
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-[var(--accent)] font-medium hover:underline"
            >
              Sign in
            </Link>
          </div>
          <div>
            <Link
              href="/policies"
              className="text-[11px] text-[var(--foreground-muted)] hover:underline"
            >
              Privacy, Terms &amp; Safety Policies
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
