"use client";

import React, { useState, useTransition } from "react";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/reports/types";
import { submitReportAction } from "@/app/actions/reports";

interface ReportModalProps {
  isOpen: boolean;
  targetType: ReportTargetType;
  targetId: string;
  targetTitle?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function ReportModal({
  isOpen,
  targetType,
  targetId,
  targetTitle,
  onClose,
  onSubmitted,
}: ReportModalProps) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await submitReportAction({
          targetType,
          targetId,
          reason,
          details: details.trim() || null,
        });

        if (res.success) {
          setSuccess(true);
          onSubmitted?.();
        } else {
          setError(res.message || "Failed to submit report. Please try again.");
        }
      } catch {
        setError("An unexpected error occurred. Please try again.");
      }
    });
  };

  const handleClose = () => {
    setSuccess(false);
    setError(null);
    setDetails("");
    setReason("spam");
    onClose();
  };

  const targetLabel =
    targetType === "post"
      ? "Post"
      : targetType === "community_post"
      ? "Community Post"
      : "User Profile";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg space-y-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
          <h2 id="report-modal-title" className="text-base font-semibold text-[var(--foreground)]">
            Report {targetLabel}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close dialog"
            className="text-[var(--foreground-muted)] hover:text-[var(--foreground)] text-sm px-2 py-1"
          >
            ✕
          </button>
        </div>

        {targetTitle && (
          <p className="text-xs text-[var(--foreground-muted)] truncate">
            Target: <span className="text-[var(--foreground)] font-medium">{targetTitle}</span>
          </p>
        )}

        {success ? (
          <div className="py-6 space-y-4 text-center">
            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold">
              ✓
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Report Submitted</h3>
              <p className="text-xs text-[var(--foreground-muted)] max-w-xs mx-auto">
                Thank you for helping keep HIHA safe. Our moderation team will review this report
                in accordance with our community guidelines.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 flex-1 overflow-y-auto">
            {error && (
              <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Reason selector */}
            <div className="space-y-1.5">
              <label htmlFor="report-reason" className="block text-xs font-medium text-[var(--foreground)]">
                Reason for report <span className="text-red-500">*</span>
              </label>
              <select
                id="report-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as ReportReason)}
                className="w-full text-xs px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {REPORT_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>

            {/* Details textarea */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="report-details" className="block text-xs font-medium text-[var(--foreground)]">
                  Additional context (optional)
                </label>
                <span className="text-[10px] text-[var(--foreground-muted)]">
                  {details.length}/1000
                </span>
              </div>
              <textarea
                id="report-details"
                rows={4}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Provide any specific details that will help our review team understand the violation..."
                className="w-full text-xs p-3 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] placeholder:text-[var(--foreground-muted)]"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-1.5 rounded-[var(--radius-sm)] bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "Submitting…" : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
