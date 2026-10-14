"use client";

import React, { useState, useEffect, useTransition, useCallback } from "react";
import {
  getModerationQueueAction,
  updateReportStatusAction,
  issueModerationAction,
  reverseModerationAction,
  getUserModerationRecordsAction,
  submitAppealAction,
  getModerationAuditLogAction,
  getModerationAppealsQueueAction,
  reviewAppealAction,
} from "@/app/actions/reports";
import {
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  MODERATION_ACTION_LABELS,
  APPEAL_STATUS_LABELS,
  DURATION_PRESETS_HOURS,
  type ModerationQueueItem,
  type ReportStatus,
  type ModerationActionType,
  type UserModerationRecord,
  type ModerationAuditItem,
  type ModerationAppealItem,
} from "@/lib/reports/types";

interface ModerationQueueViewProps {
  isPlatformStaff: boolean;
  isCommunityModerator: boolean;
}

type PrimaryTab = "reports" | "appeals" | "audit" | "my-standing";

export function ModerationQueueView({
  isPlatformStaff,
  isCommunityModerator,
}: ModerationQueueViewProps) {
  const hasModeratorAccess = isPlatformStaff || isCommunityModerator;

  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>(
    hasModeratorAccess ? "reports" : "my-standing"
  );
  const [selectedStatus, setSelectedStatus] = useState<ReportStatus | "all">("all");
  const [items, setItems] = useState<ModerationQueueItem[]>([]);
  const [appeals, setAppeals] = useState<ModerationAppealItem[]>([]);
  const [auditItems, setAuditItems] = useState<ModerationAuditItem[]>([]);
  const [myRecords, setMyRecords] = useState<UserModerationRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Report resolution dialog state
  const [activeDialog, setActiveDialog] = useState<{
    reportId: string;
    action: "resolved" | "dismissed";
  } | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  // Enforcement action modal state
  const [enforcementDialog, setEnforcementDialog] = useState<{
    report: ModerationQueueItem;
  } | null>(null);
  const [enfActionType, setEnfActionType] = useState<ModerationActionType>("warning");
  const [enfReason, setEnfReason] = useState("");
  const [enfDurationHours, setEnfDurationHours] = useState<number | "">(24);

  // Appeal review dialog state
  const [appealReviewDialog, setAppealReviewDialog] = useState<{
    appealId: string;
    decision: "approved" | "rejected";
  } | null>(null);
  const [appealReviewNote, setAppealReviewNote] = useState("");

  // Reverse audit action dialog state
  const [reverseDialog, setReverseDialog] = useState<{
    actionId: string;
  } | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  // User submit appeal dialog state
  const [userAppealDialog, setUserAppealDialog] = useState<{
    moderationActionId: string;
    actionLabel: string;
  } | null>(null);
  const [userAppealReason, setUserAppealReason] = useState("");

  const fetchActiveTab = useCallback(() => {
    setLoading(true);
    setError(null);

    if (primaryTab === "my-standing") {
      getUserModerationRecordsAction()
        .then((res) => {
          if (res.success && res.data) {
            setMyRecords(res.data);
          } else {
            setError(res.message || "Unable to load your account standing.");
          }
        })
        .catch(() => setError("Unable to load your account standing."))
        .finally(() => setLoading(false));
      return;
    }

    if (!hasModeratorAccess) {
      setLoading(false);
      return;
    }

    if (primaryTab === "reports") {
      getModerationQueueAction({
        status: selectedStatus === "all" ? undefined : selectedStatus,
      })
        .then((res) => {
          if (res.success && res.data) {
            setItems(res.data.items);
          } else {
            setError(res.message || "Failed to load moderation queue.");
          }
        })
        .catch(() => setError("Unable to load moderation queue."))
        .finally(() => setLoading(false));
    } else if (primaryTab === "appeals") {
      getModerationAppealsQueueAction()
        .then((res) => {
          if (res.success && res.data) {
            setAppeals(res.data);
          } else {
            setError(res.message || "Failed to load appeals queue.");
          }
        })
        .catch(() => setError("Unable to load appeals queue."))
        .finally(() => setLoading(false));
    } else if (primaryTab === "audit") {
      getModerationAuditLogAction()
        .then((res) => {
          if (res.success && res.data) {
            setAuditItems(res.data);
          } else {
            setError(res.message || "Failed to load enforcement audit log.");
          }
        })
        .catch(() => setError("Unable to load enforcement audit log."))
        .finally(() => setLoading(false));
    }
  }, [hasModeratorAccess, primaryTab, selectedStatus]);

  useEffect(() => {
    fetchActiveTab();
  }, [fetchActiveTab]);

  const handleClaim = (reportId: string) => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateReportStatusAction({
          reportId,
          status: "in_review",
        });
        if (res.success) {
          fetchActiveTab();
        } else {
          setError(res.message || "Failed to claim report.");
        }
      } catch {
        setError("An error occurred while updating the report.");
      }
    });
  };

  const handleFinalize = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDialog || isPending) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await updateReportStatusAction({
          reportId: activeDialog.reportId,
          status: activeDialog.action,
          resolutionNote: resolutionNote.trim() || null,
        });

        if (res.success) {
          setActiveDialog(null);
          setResolutionNote("");
          fetchActiveTab();
        } else {
          setError(res.message || "Failed to update report status.");
        }
      } catch {
        setError("An error occurred while updating the report.");
      }
    });
  };

  const handleIssueEnforcement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!enforcementDialog || isPending) return;

    const r = enforcementDialog.report;
    const resolvedTargetType =
      enfActionType === "account_restriction" ? "profile" : r.target_type;
    const resolvedTargetId =
      enfActionType === "account_restriction"
        ? r.target_type === "profile"
          ? r.target_id
          : r.targetSummary?.authorId || r.target_id
        : r.target_id;

    setError(null);
    startTransition(async () => {
      try {
        const res = await issueModerationAction({
          targetType: resolvedTargetType,
          targetId: resolvedTargetId,
          actionType: enfActionType,
          reason: enfReason.trim(),
          durationHours: enfDurationHours === "" ? null : Number(enfDurationHours),
          reportId: r.id,
        });

        if (res.success) {
          setEnforcementDialog(null);
          setEnfReason("");
          setFeedback("Moderation enforcement action recorded in audit history.");
          fetchActiveTab();
        } else {
          setError(res.message || "Failed to issue enforcement action.");
        }
      } catch {
        setError("An error occurred while issuing the enforcement action.");
      }
    });
  };

  const handleReverseAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseDialog || isPending) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await reverseModerationAction({
          actionId: reverseDialog.actionId,
          reversalReason: reversalReason.trim(),
        });

        if (res.success) {
          setReverseDialog(null);
          setReversalReason("");
          setFeedback("Enforcement action reversed. Audit record preserved.");
          fetchActiveTab();
        } else {
          setError(res.message || "Failed to reverse enforcement action.");
        }
      } catch {
        setError("An error occurred while reversing the enforcement action.");
      }
    });
  };

  const handleReviewAppeal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appealReviewDialog || isPending) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await reviewAppealAction({
          appealId: appealReviewDialog.appealId,
          status: appealReviewDialog.decision,
          resolutionNote: appealReviewNote.trim() || null,
        });

        if (res.success) {
          setAppealReviewDialog(null);
          setAppealReviewNote("");
          setFeedback(
            appealReviewDialog.decision === "approved"
              ? "Appeal approved and enforcement restriction reversed."
              : "Appeal decision recorded."
          );
          fetchActiveTab();
        } else {
          setError(res.message || "Failed to review appeal.");
        }
      } catch {
        setError("An error occurred while reviewing the appeal.");
      }
    });
  };

  const handleSubmitUserAppeal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAppealDialog || isPending) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await submitAppealAction({
          moderationActionId: userAppealDialog.moderationActionId,
          reason: userAppealReason.trim(),
        });

        if (res.success) {
          setUserAppealDialog(null);
          setUserAppealReason("");
          setFeedback("Your appeal has been submitted for review.");
          fetchActiveTab();
        } else {
          setError(res.message || "Failed to submit appeal.");
        }
      } catch {
        setError("An error occurred while submitting your appeal.");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
            Trust & Safety Center
          </h1>
          <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
            {isPlatformStaff
              ? "Platform Staff"
              : isCommunityModerator
              ? "Community Moderator"
              : "Member Standing & Appeals"}
          </span>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          Auditable content moderation, temporary restriction management, and transparent appeals.
        </p>
      </div>

      {/* Primary Section Navigation */}
      <div
        role="tablist"
        aria-label="Trust and Safety Sections"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3 text-xs"
      >
        {hasModeratorAccess && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={primaryTab === "reports"}
              onClick={() => {
                setFeedback(null);
                setPrimaryTab("reports");
              }}
              className={`px-3.5 py-1.5 rounded font-semibold transition-colors ${
                primaryTab === "reports"
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Reports Queue
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={primaryTab === "appeals"}
              onClick={() => {
                setFeedback(null);
                setPrimaryTab("appeals");
              }}
              className={`px-3.5 py-1.5 rounded font-semibold transition-colors ${
                primaryTab === "appeals"
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Appeals Review
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={primaryTab === "audit"}
              onClick={() => {
                setFeedback(null);
                setPrimaryTab("audit");
              }}
              className={`px-3.5 py-1.5 rounded font-semibold transition-colors ${
                primaryTab === "audit"
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Enforcement Audit Log
            </button>
          </>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={primaryTab === "my-standing"}
          onClick={() => {
            setFeedback(null);
            setPrimaryTab("my-standing");
          }}
          className={`px-3.5 py-1.5 rounded font-semibold transition-colors ${
            primaryTab === "my-standing"
              ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
              : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
          }`}
        >
          My Standing & Appeals
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className="p-3 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {feedback}
        </div>
      )}

      {/* TAB 1: REPORTS QUEUE */}
      {primaryTab === "reports" && hasModeratorAccess && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setSelectedStatus("all")}
              className={`px-3 py-1 rounded transition-colors font-medium ${
                selectedStatus === "all"
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--foreground-muted)] hover:text-[var(--foreground)] bg-[var(--surface-muted)]"
              }`}
            >
              All
            </button>
            {REPORT_STATUSES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setSelectedStatus(st)}
                className={`px-3 py-1 rounded transition-colors font-medium capitalize ${
                  selectedStatus === st
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)] bg-[var(--surface-muted)]"
                }`}
              >
                {st.replace("_", " ")}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--foreground-muted)]">
              Loading moderation queue…
            </div>
          ) : items.length === 0 ? (
            <div className="p-10 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-center space-y-2">
              <p className="text-sm font-semibold text-[var(--foreground)]">Queue is clear</p>
              <p className="text-xs text-[var(--foreground-muted)]">
                No reports found matching the selected filter.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((r) => {
                const isResolvedOrDismissed =
                  r.status === "resolved" || r.status === "dismissed";
                return (
                  <article
                    key={r.id}
                    className="p-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] shadow-xs space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[var(--surface-muted)] border border-[var(--border)] uppercase font-semibold text-[var(--foreground)]">
                          {r.target_type.replace("_", " ")}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                            r.status === "open"
                              ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900"
                              : r.status === "in_review"
                              ? "bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-900"
                              : r.status === "resolved"
                              ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900"
                              : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                          }`}
                        >
                          {r.status.replace("_", " ")}
                        </span>
                        {r.community && (
                          <span className="text-[11px] text-[var(--foreground-muted)]">
                            in{" "}
                            <span className="font-medium text-[var(--foreground)]">
                              c/{r.community.slug}
                            </span>
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-[var(--foreground-muted)]">
                        Reported {new Date(r.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="p-3 rounded bg-[var(--surface-muted)] border border-[var(--border-subtle)] space-y-1">
                      <span className="text-[10px] font-mono text-[var(--foreground-muted)] uppercase tracking-wider block">
                        Target Context
                      </span>
                      {r.targetSummary ? (
                        <div className="text-xs space-y-0.5">
                          {r.targetSummary.authorUsername && (
                            <p className="text-[var(--foreground-muted)]">
                              Author:{" "}
                              <span className="font-medium text-[var(--foreground)]">
                                @{r.targetSummary.authorUsername}
                              </span>
                            </p>
                          )}
                          {r.targetSummary.titleOrCaption && (
                            <p className="text-[var(--foreground)] font-medium line-clamp-2">
                              {r.targetSummary.titleOrCaption}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--foreground-muted)] font-mono">
                          Target ID: {r.target_id}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1 text-xs">
                      <p className="font-semibold text-[var(--foreground)]">
                        Reason:{" "}
                        <span className="font-normal text-[var(--foreground)]">
                          {REPORT_REASON_LABELS[r.reason] || r.reason}
                        </span>
                      </p>
                      {r.details && (
                        <p className="text-[var(--foreground-muted)] italic leading-relaxed">
                          &ldquo;{r.details}&rdquo;
                        </p>
                      )}
                    </div>

                    {isResolvedOrDismissed && r.resolution_note && (
                      <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-900 border border-[var(--border-subtle)] text-xs">
                        <span className="font-semibold text-[var(--foreground)] block">
                          Moderation Note:
                        </span>
                        <span className="text-[var(--foreground-muted)]">{r.resolution_note}</span>
                      </div>
                    )}

                    {!isResolvedOrDismissed && (
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                        {r.status === "open" && (
                          <button
                            type="button"
                            onClick={() => handleClaim(r.id)}
                            disabled={isPending}
                            className="px-3 py-1 rounded border border-[var(--border)] text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
                          >
                            Claim / In Review
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setActiveDialog({ reportId: r.id, action: "dismissed" })
                          }
                          disabled={isPending}
                          className="px-3 py-1 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors"
                        >
                          Dismiss…
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveDialog({ reportId: r.id, action: "resolved" })
                          }
                          disabled={isPending}
                          className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                        >
                          Resolve…
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEnfActionType(
                              r.target_type === "profile" ? "warning" : "content_restriction"
                            );
                            setEnfReason("");
                            setEnfDurationHours(24);
                            setEnforcementDialog({ report: r });
                          }}
                          disabled={isPending}
                          className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors"
                        >
                          Issue Enforcement…
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: APPEALS REVIEW */}
      {primaryTab === "appeals" && hasModeratorAccess && (
        <div className="space-y-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--foreground-muted)]">
              Loading appeals queue…
            </div>
          ) : appeals.length === 0 ? (
            <div className="p-10 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-center space-y-2">
              <p className="text-sm font-semibold text-[var(--foreground)]">No appeals pending</p>
              <p className="text-xs text-[var(--foreground-muted)]">
                Submitted user appeals against active moderation actions will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {appeals.map((app) => {
                const isFinal = app.status === "approved" || app.status === "rejected";
                return (
                  <article
                    key={app.id}
                    className="p-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[var(--surface-muted)] border border-[var(--border)] uppercase font-semibold">
                          Appeal
                        </span>
                        <span className="text-xs font-semibold text-[var(--foreground)]">
                          {APPEAL_STATUS_LABELS[app.status]}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--foreground-muted)]">
                        Submitted {new Date(app.created_at).toLocaleString()}
                      </span>
                    </div>

                    {app.action && (
                      <div className="p-3 rounded bg-[var(--surface-muted)] border border-[var(--border-subtle)] text-xs space-y-1">
                        <p className="font-semibold text-[var(--foreground)]">
                          Original Action:{" "}
                          {MODERATION_ACTION_LABELS[app.action.action_type] ||
                            app.action.action_type}{" "}
                          ({app.action.target_type})
                        </p>
                        <p className="text-[var(--foreground-muted)]">
                          Original Reason: {app.action.reason}
                        </p>
                      </div>
                    )}

                    <div className="text-xs space-y-1">
                      <span className="font-semibold text-[var(--foreground)] block">
                        Appellant Statement:
                      </span>
                      <p className="text-[var(--foreground-secondary)] italic">
                        &ldquo;{app.reason}&rdquo;
                      </p>
                    </div>

                    {app.resolution_note && (
                      <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-900 border border-[var(--border-subtle)] text-xs">
                        <span className="font-semibold block">Review Decision Note:</span>
                        <span className="text-[var(--foreground-muted)]">
                          {app.resolution_note}
                        </span>
                      </div>
                    )}

                    {!isFinal && (
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                        <button
                          type="button"
                          onClick={() =>
                            setAppealReviewDialog({ appealId: app.id, decision: "rejected" })
                          }
                          disabled={isPending}
                          className="px-3 py-1 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                        >
                          Reject Appeal…
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAppealReviewDialog({ appealId: app.id, decision: "approved" })
                          }
                          disabled={isPending}
                          className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                        >
                          Approve & Reverse Action…
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ENFORCEMENT AUDIT LOG */}
      {primaryTab === "audit" && hasModeratorAccess && (
        <div className="space-y-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--foreground-muted)]">
              Loading tamper-resistant audit log…
            </div>
          ) : auditItems.length === 0 ? (
            <div className="p-10 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-center space-y-2">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                No enforcement actions recorded
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">
                All warnings, content restrictions, and temporary account restrictions are logged
                immutably here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {auditItems.map((act) => (
                <article
                  key={act.id}
                  className="p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[var(--surface-muted)] border border-[var(--border)] uppercase font-semibold">
                        {MODERATION_ACTION_LABELS[act.action_type]}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-medium uppercase ${
                          act.effective_status === "active"
                            ? "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-900"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                        }`}
                      >
                        {act.effective_status}
                      </span>
                      <span className="text-[var(--foreground-muted)] font-mono text-[11px]">
                        Target: {act.target_type} ({act.target_id.slice(0, 8)}…)
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--foreground-muted)]">
                      {new Date(act.created_at).toLocaleString()}
                    </span>
                  </div>

                  <p className="text-[var(--foreground)]">
                    <span className="font-semibold">Reason:</span> {act.reason}
                  </p>

                  {act.expires_at && (
                    <p className="text-[11px] text-[var(--foreground-muted)]">
                      Expires: {new Date(act.expires_at).toLocaleString()} (
                      {act.duration_hours}h)
                    </p>
                  )}

                  {act.status === "reversed" && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      Reversed{" "}
                      {act.reversed_at ? new Date(act.reversed_at).toLocaleString() : ""}:{" "}
                      {act.reversal_reason}
                    </p>
                  )}

                  {act.effective_status === "active" && (
                    <div className="flex justify-end pt-2 border-t border-[var(--border-subtle)]">
                      <button
                        type="button"
                        onClick={() => setReverseDialog({ actionId: act.id })}
                        disabled={isPending}
                        className="px-3 py-1 rounded border border-[var(--border)] text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                      >
                        Reverse Action…
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: MY STANDING & APPEALS (ALL USERS) */}
      {primaryTab === "my-standing" && (
        <div className="space-y-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--foreground-muted)]">
              Loading your account standing…
            </div>
          ) : myRecords.length === 0 ? (
            <div className="p-8 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-center space-y-2">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Your account is in good standing
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">
                You have no active or historical moderation restrictions on your account or
                content.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {myRecords.map((rec) => {
                const canAppeal = rec.effective_status === "active" && !rec.appeal;
                return (
                  <article
                    key={rec.id}
                    className="p-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] space-y-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-[var(--foreground)]">
                          {MODERATION_ACTION_LABELS[rec.action_type]}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase ${
                            rec.effective_status === "active"
                              ? "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-900"
                              : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                          }`}
                        >
                          {rec.effective_status}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--foreground-muted)]">
                        Issued {new Date(rec.created_at).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-[var(--foreground)]">
                      <span className="font-semibold">Reason:</span> {rec.reason}
                    </p>

                    {rec.expires_at && (
                      <p className="text-[11px] text-[var(--foreground-muted)]">
                        Expiration: {new Date(rec.expires_at).toLocaleString()}
                      </p>
                    )}

                    {rec.status === "reversed" && (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        This action was reversed:{" "}
                        {rec.reversal_reason || "Appeal approved"}
                      </p>
                    )}

                    {rec.appeal && (
                      <div className="p-3 rounded bg-[var(--surface-muted)] border border-[var(--border-subtle)] space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[var(--foreground)]">
                            Your Appeal ({APPEAL_STATUS_LABELS[rec.appeal.status]})
                          </span>
                          <span className="text-[10px] text-[var(--foreground-muted)]">
                            {new Date(rec.appeal.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-[var(--foreground-muted)] italic">
                          &ldquo;{rec.appeal.reason}&rdquo;
                        </p>
                        {rec.appeal.resolution_note && (
                          <p className="text-[var(--foreground)] pt-1">
                            <span className="font-semibold">Reviewer Note:</span>{" "}
                            {rec.appeal.resolution_note}
                          </p>
                        )}
                      </div>
                    )}

                    {canAppeal && (
                      <div className="flex justify-end pt-2 border-t border-[var(--border-subtle)]">
                        <button
                          type="button"
                          onClick={() =>
                            setUserAppealDialog({
                              moderationActionId: rec.id,
                              actionLabel: MODERATION_ACTION_LABELS[rec.action_type],
                            })
                          }
                          disabled={isPending}
                          className="px-3.5 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90"
                        >
                          Submit Appeal…
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* DIALOG 1: Report Resolution Prompt */}
      {activeDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-[var(--foreground)] capitalize">
              {activeDialog.action} Report
            </h3>
            <form onSubmit={handleFinalize} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="moderation-note"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Resolution Note (optional, max 1000 chars)
                </label>
                <textarea
                  id="moderation-note"
                  rows={3}
                  maxLength={1000}
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Document findings or rationale for this decision..."
                  className="w-full text-xs p-3 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => {
                    setActiveDialog(null);
                    setResolutionNote("");
                  }}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className={`px-4 py-1.5 rounded text-xs font-semibold text-white ${
                    activeDialog.action === "resolved"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-gray-600 hover:bg-gray-700"
                  }`}
                >
                  {isPending ? "Submitting…" : `Confirm ${activeDialog.action}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG 2: Issue Moderation Enforcement Action */}
      {enforcementDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-enforcement-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg space-y-4">
            <h3
              id="issue-enforcement-title"
              className="text-base font-semibold text-[var(--foreground)]"
            >
              Issue Enforcement Action
            </h3>
            <form onSubmit={handleIssueEnforcement} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="enf-action-type"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Action Type
                </label>
                <select
                  id="enf-action-type"
                  value={enfActionType}
                  onChange={(e) => setEnfActionType(e.target.value as ModerationActionType)}
                  className="w-full text-xs px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                >
                  <option value="warning">Formal Warning</option>
                  {enforcementDialog.report.target_type !== "profile" && (
                    <option value="content_restriction">Content Restriction</option>
                  )}
                  {isPlatformStaff && (
                    <option value="account_restriction">
                      Temporary Account Restriction (Global)
                    </option>
                  )}
                </select>
              </div>

              {(enfActionType === "account_restriction" ||
                enfActionType === "content_restriction") && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="enf-duration"
                    className="block text-xs font-medium text-[var(--foreground)]"
                  >
                    Duration (hours){" "}
                    {enfActionType === "account_restriction" ? "(required)" : "(optional)"}
                  </label>
                  <select
                    id="enf-duration"
                    value={enfDurationHours}
                    onChange={(e) =>
                      setEnfDurationHours(
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                    className="w-full text-xs px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                  >
                    {enfActionType !== "account_restriction" && (
                      <option value="">Indefinite (until appealed or reversed)</option>
                    )}
                    {DURATION_PRESETS_HOURS.map((hrs) => (
                      <option key={hrs} value={hrs}>
                        {hrs} hours ({hrs / 24} {hrs === 24 ? "day" : "days"})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="enf-reason"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Enforcement Reason (shown to affected user, min 3 chars)
                </label>
                <textarea
                  id="enf-reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={3}
                  value={enfReason}
                  onChange={(e) => setEnfReason(e.target.value)}
                  placeholder="Specify the policy violation and rationale..."
                  className="w-full text-xs p-3 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setEnforcementDialog(null)}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || enfReason.trim().length < 3}
                  className="px-4 py-1.5 rounded bg-red-600 hover:bg-red-700 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {isPending ? "Issuing…" : "Confirm Enforcement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG 3: Reverse Audit Action */}
      {reverseDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              Reverse Enforcement Action
            </h3>
            <form onSubmit={handleReverseAction} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="reversal-reason"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Reversal Reason (logged to audit history)
                </label>
                <textarea
                  id="reversal-reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={3}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="Document why this restriction is being lifted..."
                  className="w-full text-xs p-3 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => {
                    setReverseDialog(null);
                    setReversalReason("");
                  }}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || reversalReason.trim().length < 3}
                  className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {isPending ? "Reversing…" : "Confirm Reversal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG 4: Review Appeal */}
      {appealReviewDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-[var(--foreground)] capitalize">
              {appealReviewDialog.decision} Appeal
            </h3>
            <form onSubmit={handleReviewAppeal} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="appeal-review-note"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Resolution Note (optional, shared with appellant)
                </label>
                <textarea
                  id="appeal-review-note"
                  rows={3}
                  maxLength={1000}
                  value={appealReviewNote}
                  onChange={(e) => setAppealReviewNote(e.target.value)}
                  placeholder="Explain the outcome of the appeal review..."
                  className="w-full text-xs p-3 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => {
                    setAppealReviewDialog(null);
                    setAppealReviewNote("");
                  }}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className={`px-4 py-1.5 rounded text-xs font-semibold text-white ${
                    appealReviewDialog.decision === "approved"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-gray-600 hover:bg-gray-700"
                  }`}
                >
                  {isPending ? "Saving…" : `Confirm ${appealReviewDialog.decision}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG 5: Affected User Appeal Submission */}
      {userAppealDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-appeal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg space-y-4">
            <h3
              id="submit-appeal-title"
              className="text-base font-semibold text-[var(--foreground)]"
            >
              Appeal {userAppealDialog.actionLabel}
            </h3>
            <form onSubmit={handleSubmitUserAppeal} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="user-appeal-reason"
                    className="block text-xs font-medium text-[var(--foreground)]"
                  >
                    Why should this decision be reversed? (10–1,000 chars)
                  </label>
                  <span className="text-[10px] text-[var(--foreground-muted)]">
                    {userAppealReason.length}/1000
                  </span>
                </div>
                <textarea
                  id="user-appeal-reason"
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={4}
                  value={userAppealReason}
                  onChange={(e) => setUserAppealReason(e.target.value)}
                  placeholder="Provide context explaining why this content or account action was applied in error..."
                  className="w-full text-xs p-3 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => {
                    setUserAppealDialog(null);
                    setUserAppealReason("");
                  }}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--foreground-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || userAppealReason.trim().length < 10}
                  className="px-4 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {isPending ? "Submitting…" : "Submit Appeal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
