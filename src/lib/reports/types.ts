import { z } from "zod";
import type {
  ContentReport,
  ModerationAction,
  ModerationAppeal,
  Profile,
} from "@/lib/supabase/types";

// ============================================================
// Constants
// ============================================================

export const REPORT_TARGET_TYPES = ["post", "community_post", "profile"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "misinformation",
  "violence",
  "copyright",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or automated engagement",
  harassment: "Harassment or bullying",
  hate_speech: "Hate speech or discriminatory content",
  misinformation: "Misleading or fraudulent information",
  violence: "Violence or dangerous organizations",
  copyright: "Intellectual property or copyright violation",
  other: "Other community policy violation",
};

export const REPORT_STATUSES = ["open", "in_review", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  in_review: "In Review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const MODERATION_ACTION_TYPES = [
  "warning",
  "content_restriction",
  "account_restriction",
] as const;
export type ModerationActionType = (typeof MODERATION_ACTION_TYPES)[number];

export const MODERATION_ACTION_LABELS: Record<ModerationActionType, string> = {
  warning: "Formal Warning",
  content_restriction: "Content Restriction",
  account_restriction: "Temporary Account Restriction",
};

export const MODERATION_ACTION_STATUSES = ["active", "reversed", "expired"] as const;
export type ModerationActionStatus = (typeof MODERATION_ACTION_STATUSES)[number];

export const APPEAL_STATUSES = ["pending", "under_review", "approved", "rejected"] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = {
  pending: "Pending Review",
  under_review: "Under Review",
  approved: "Approved (Action Reversed)",
  rejected: "Rejected",
};

export const DURATION_PRESETS_HOURS = [24, 72, 168, 720] as const;

// ============================================================
// Validation Schemas
// ============================================================

export const submitReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES, {
    message: "Invalid report target type.",
  }),
  targetId: z.string().uuid("Invalid target identifier."),
  reason: z.enum(REPORT_REASONS, {
    message: "Please select a valid report reason.",
  }),
  details: z
    .string()
    .trim()
    .max(1000, "Details cannot exceed 1,000 characters.")
    .optional()
    .nullable(),
});

export type SubmitReportInput = z.infer<typeof submitReportSchema>;

export const updateReportStatusSchema = z.object({
  reportId: z.string().uuid("Invalid report identifier."),
  status: z.enum(REPORT_STATUSES, {
    message: "Invalid status value.",
  }),
  resolutionNote: z
    .string()
    .trim()
    .max(1000, "Resolution note cannot exceed 1,000 characters.")
    .optional()
    .nullable(),
});

export type UpdateReportStatusInput = z.infer<typeof updateReportStatusSchema>;

export const moderationQueueFilterSchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  communityId: z.string().uuid().optional().nullable(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(50).optional().default(20),
});

export type ModerationQueueFilterInput = z.input<typeof moderationQueueFilterSchema>;

export const issueModerationActionSchema = z
  .object({
    targetType: z.enum(REPORT_TARGET_TYPES, {
      message: "Invalid target type.",
    }),
    targetId: z.string().uuid("Invalid target identifier."),
    actionType: z.enum(MODERATION_ACTION_TYPES, {
      message: "Invalid moderation action type.",
    }),
    reason: z
      .string()
      .trim()
      .min(3, "Reason must be at least 3 characters.")
      .max(1000, "Reason cannot exceed 1,000 characters."),
    durationHours: z
      .number()
      .int("Duration must be a whole number of hours.")
      .min(1, "Duration must be at least 1 hour.")
      .max(8760, "Duration cannot exceed 8,760 hours (365 days).")
      .optional()
      .nullable(),
    reportId: z.string().uuid("Invalid report identifier.").optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.actionType === "account_restriction") {
      if (val.targetType !== "profile") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetType"],
          message: "Temporary account restrictions must target a user profile.",
        });
      }
      if (!val.durationHours || val.durationHours < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["durationHours"],
          message: "Temporary account restrictions require an explicit duration in hours (1–8760).",
        });
      }
    }

    if (val.actionType === "content_restriction") {
      if (val.targetType !== "post" && val.targetType !== "community_post") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetType"],
          message: "Content restrictions must target a post or community post.",
        });
      }
    }
  });

export type IssueModerationActionInput = z.infer<typeof issueModerationActionSchema>;

export const reverseModerationActionSchema = z.object({
  actionId: z.string().uuid("Invalid moderation action identifier."),
  reversalReason: z
    .string()
    .trim()
    .min(3, "Reversal reason must be at least 3 characters.")
    .max(1000, "Reversal reason cannot exceed 1,000 characters."),
});

export type ReverseModerationActionInput = z.infer<typeof reverseModerationActionSchema>;

export const submitAppealSchema = z.object({
  moderationActionId: z.string().uuid("Invalid moderation action identifier."),
  reason: z
    .string()
    .trim()
    .min(10, "Appeal reason must be at least 10 characters.")
    .max(1000, "Appeal reason cannot exceed 1,000 characters."),
});

export type SubmitAppealInput = z.infer<typeof submitAppealSchema>;

export const reviewAppealSchema = z.object({
  appealId: z.string().uuid("Invalid appeal identifier."),
  status: z.enum(["under_review", "approved", "rejected"] as const, {
    message: "Invalid appeal review status.",
  }),
  resolutionNote: z
    .string()
    .trim()
    .max(1000, "Resolution note cannot exceed 1,000 characters.")
    .optional()
    .nullable(),
});

export type ReviewAppealInput = z.infer<typeof reviewAppealSchema>;

/**
 * Pure helper computing the effective enforcement status at a given reference time.
 * Temporary actions with expires_at <= now deterministically evaluate to 'expired'.
 */
export function getEffectiveActionStatus(
  status: ModerationActionStatus,
  expiresAt: string | null,
  nowMs: number = Date.now()
): ModerationActionStatus {
  if (status === "active" && expiresAt) {
    const expMs = new Date(expiresAt).getTime();
    if (!Number.isNaN(expMs) && expMs <= nowMs) {
      return "expired";
    }
  }
  return status;
}

// ============================================================
// Sanitized Data Transfer Interfaces
// ============================================================

/**
 * Sanitized report view returned to the reporting user.
 * Strips internal reviewer identity and private resolution notes.
 */
export interface ReporterReportItem {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Extended moderation item for authorized staff/moderators.
 */
export interface ModerationQueueItem extends ContentReport {
  reporter?: Profile | null;
  community?: { id: string; name: string; slug: string } | null;
  targetSummary?: {
    titleOrCaption?: string | null;
    authorUsername?: string | null;
    authorId?: string | null;
  } | null;
}

/**
 * Sanitized moderation action record returned to the affected user.
 * Strips internal staff actor_id and confidential report_id.
 */
export interface UserModerationRecord {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  community_id: string | null;
  action_type: ModerationActionType;
  reason: string;
  duration_hours: number | null;
  expires_at: string | null;
  status: ModerationActionStatus;
  effective_status: ModerationActionStatus;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
  appeal?: {
    id: string;
    reason: string;
    status: AppealStatus;
    reviewed_at: string | null;
    resolution_note: string | null;
    created_at: string;
  } | null;
}

/**
 * Full audit record for authorized platform staff and community moderators.
 */
export interface ModerationAuditItem extends ModerationAction {
  effective_status: ModerationActionStatus;
  targetUser?: { id: string; username: string; display_name: string } | null;
  community?: { id: string; name: string; slug: string } | null;
  appeal?: ModerationAppeal | null;
}

/**
 * Appeal queue item for authorized platform staff and community moderators.
 */
export interface ModerationAppealItem extends ModerationAppeal {
  action?: ModerationAction | null;
  appellant?: { id: string; username: string; display_name: string } | null;
}
