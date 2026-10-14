import { z } from "zod";
import { MEDIA_CONSTRAINTS } from "@/lib/storage/types";
import {
  aiDisclosureDetailsSchema,
  aiDisclosureStatusSchema,
  type AiDisclosureStatus,
  type CollaborativeOutputProvenance,
  type ProvenanceStatus,
} from "@/lib/authenticity/types";

export const PROJECT_STATUSES = [
  "draft",
  "open",
  "locked",
  "rendering",
  "completed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_VISIBILITIES = ["public", "private"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const PARTICIPATION_MODES = ["open", "invite_only"] as const;
export type ParticipationMode = (typeof PARTICIPATION_MODES)[number];

export const PARTICIPANT_ROLES = ["owner", "editor", "contributor"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const PARTICIPANT_STATUSES = [
  "invited",
  "requested",
  "active",
  "declined",
  "removed",
] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const CONTRIBUTION_MEDIA_TYPES = ["short_video", "long_video"] as const;
export type ContributionMediaType = (typeof CONTRIBUTION_MEDIA_TYPES)[number];

export const CONTRIBUTION_REVIEW_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type ContributionReviewStatus = (typeof CONTRIBUTION_REVIEW_STATUSES)[number];

export const RENDER_JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;
export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number];

export const CURRENT_CONSENT_POLICY_VERSION = "v1.0-collaborative-2026" as const;

export const COLLABORATIVE_CONSENT_DISCLOSURE = {
  version: CURRENT_CONSENT_POLICY_VERSION,
  summary:
    "I grant explicit permission for this video clip to be reviewed by project editors and stitched into the final combined video for this collaborative project.",
  withdrawalPolicy:
    "You may withdraw consent at any time. Withdrawing before or during rendering immediately excludes your clip and aborts active render jobs. Withdrawing after completion removes the combined project output from platform access, though copies already downloaded by viewers during an active 5-minute signed URL window cannot be retroactively erased from external devices.",
} as const;

export const createProjectSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, "Project title must be at least 2 characters")
      .max(150, "Project title cannot exceed 150 characters"),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2,000 characters")
      .optional()
      .nullable(),
    communityId: z.string().uuid("Invalid community ID").optional().nullable(),
    visibility: z.enum(PROJECT_VISIBILITIES).default("public"),
    participationMode: z.enum(PARTICIPATION_MODES).default("open"),
    status: z.enum(["draft", "open"] as const).default("open"),
  })
  .refine(
    (data) => {
      if (data.visibility === "private" && data.participationMode !== "invite_only") {
        return false;
      }
      return true;
    },
    {
      message: "Private projects must use invite-only participation",
      path: ["participationMode"],
    }
  );

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    projectId: z.string().uuid("Invalid project ID"),
    title: z
      .string()
      .trim()
      .min(2, "Project title must be at least 2 characters")
      .max(150, "Project title cannot exceed 150 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2,000 characters")
      .optional()
      .nullable(),
    status: z
      .enum(["draft", "open", "locked", "cancelled"] as const)
      .optional(),
    visibility: z.enum(PROJECT_VISIBILITIES).optional(),
    participationMode: z.enum(PARTICIPATION_MODES).optional(),
  })
  .refine(
    (data) => {
      if (data.visibility === "private" && data.participationMode === "open") {
        return false;
      }
      return true;
    },
    {
      message: "Private projects must use invite-only participation",
      path: ["participationMode"],
    }
  );

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const inviteParticipantSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  targetUserId: z.string().uuid("Invalid target user ID"),
  role: z.enum(["editor", "contributor"] as const).default("contributor"),
});

export type InviteParticipantInput = z.infer<typeof inviteParticipantSchema>;

export const respondParticipationSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  decision: z.enum(["accept", "decline"] as const),
});

export type RespondParticipationInput = z.infer<typeof respondParticipationSchema>;

export const manageParticipantSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  participantUserId: z.string().uuid("Invalid participant user ID"),
  action: z.enum([
    "approve_request",
    "reject_request",
    "promote_editor",
    "demote_contributor",
    "remove",
  ] as const),
});

export type ManageParticipantInput = z.infer<typeof manageParticipantSchema>;

export const submitContributionSchema = z
  .object({
    projectId: z.string().uuid("Invalid project ID"),
    sourcePostId: z.string().uuid("Invalid source post ID").optional().nullable(),
    mediaPath: z
      .string()
      .regex(
        /^[0-9a-fA-F-]{36}\/[a-zA-Z0-9._-]+$/,
        "Invalid media path format. Must follow '{userId}/{fileId}.{ext}'"
      ),
    mediaType: z.enum(CONTRIBUTION_MEDIA_TYPES).default("short_video"),
    mediaMetadata: z.object({
      mimeType: z.string().min(1, "MIME type is required"),
      sizeBytes: z.number().int().positive("File size must be positive"),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      durationSeconds: z.number().positive().max(3600).optional(),
    }),
    caption: z
      .string()
      .trim()
      .max(500, "Clip note cannot exceed 500 characters")
      .optional()
      .nullable(),
    aiDisclosureStatus: aiDisclosureStatusSchema.default("not_declared"),
    aiDisclosureDetails: aiDisclosureDetailsSchema,
    consentGranted: z.literal(true, {
      message: "Explicit usage consent is required before submitting a clip",
    }),
    consentPolicyVersion: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .refine((v) => v === CURRENT_CONSENT_POLICY_VERSION, {
        message: `Consent policy version must match ${CURRENT_CONSENT_POLICY_VERSION}`,
      }),
  })
  .superRefine((data, ctx) => {
    const ext = data.mediaPath.split(".").pop()?.toLowerCase() ?? "";
    const constraints = MEDIA_CONSTRAINTS[data.mediaType];
    if (!constraints.allowedExtensions.includes(ext)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File extension .${ext} is not allowed for ${data.mediaType}`,
        path: ["mediaPath"],
      });
    }
    if (!constraints.allowedMimeTypes.includes(data.mediaMetadata.mimeType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `MIME type ${data.mediaMetadata.mimeType} is not allowed for ${data.mediaType}`,
        path: ["mediaMetadata", "mimeType"],
      });
    }
    if (data.mediaMetadata.sizeBytes > constraints.maxSizeBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File size exceeds maximum limit for ${data.mediaType}`,
        path: ["mediaMetadata", "sizeBytes"],
      });
    }
    if (
      constraints.maxDurationSeconds &&
      data.mediaMetadata.durationSeconds &&
      data.mediaMetadata.durationSeconds > constraints.maxDurationSeconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Clip duration cannot exceed ${constraints.maxDurationSeconds}s for ${data.mediaType}`,
        path: ["mediaMetadata", "durationSeconds"],
      });
    }
    if (
      data.aiDisclosureStatus === "not_declared" &&
      data.aiDisclosureDetails
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Disclosure details require selecting a disclosure status other than not_declared",
        path: ["aiDisclosureDetails"],
      });
    }
  });

export type SubmitContributionInput = z.infer<typeof submitContributionSchema>;

export const withdrawConsentSchema = z.object({
  contributionId: z.string().uuid("Invalid contribution ID"),
  reason: z
    .string()
    .trim()
    .max(500, "Withdrawal note cannot exceed 500 characters")
    .optional()
    .nullable(),
});

export type WithdrawConsentInput = z.infer<typeof withdrawConsentSchema>;

export const reviewContributionSchema = z.object({
  contributionId: z.string().uuid("Invalid contribution ID"),
  decision: z.enum(["approved", "rejected"] as const),
  reviewNote: z
    .string()
    .trim()
    .max(500, "Review note cannot exceed 500 characters")
    .optional()
    .nullable(),
  sequenceOrder: z.number().int().min(1).max(1000).optional(),
});

export type ReviewContributionInput = z.infer<typeof reviewContributionSchema>;

export const reorderContributionsSchema = z
  .object({
    projectId: z.string().uuid("Invalid project ID"),
    orderedContributionIds: z
      .array(z.string().uuid("Invalid contribution ID"))
      .min(1, "Must provide at least one contribution to order")
      .max(100, "Cannot reorder more than 100 clips at once"),
  })
  .refine(
    (data) =>
      new Set(data.orderedContributionIds).size ===
      data.orderedContributionIds.length,
    {
      message: "Duplicate contribution IDs are not allowed in sequence ordering",
      path: ["orderedContributionIds"],
    }
  );

export type ReorderContributionsInput = z.infer<typeof reorderContributionsSchema>;

export const requestRenderSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  idempotencyKey: z
    .string()
    .trim()
    .min(4, "Idempotency key must be at least 4 characters")
    .max(128, "Idempotency key cannot exceed 128 characters"),
  simulateExecution: z.boolean().optional().default(false),
});

export type RequestRenderInput = z.infer<typeof requestRenderSchema>;

export const retryRenderJobSchema = z.object({
  jobId: z.string().uuid("Invalid render job ID"),
});

export type RetryRenderJobInput = z.infer<typeof retryRenderJobSchema>;

export interface RenderManifestItem {
  contribution_id: string;
  contributor_id: string;
  media_path: string;
  media_type: ContributionMediaType;
  sequence_order: number;
  consent_granted_at: string;
  consent_policy_version: string;
  ai_disclosure_status?: AiDisclosureStatus;
}

export interface ProjectSummaryDTO {
  id: string;
  creatorId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  communityId: string | null;
  communityName: string | null;
  communitySlug: string | null;
  title: string;
  description: string | null;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  participationMode: ParticipationMode;
  consentPolicyVersion: string;
  hasOutputMedia: boolean;
  outputProvenance: CollaborativeOutputProvenance | null;
  viewerRole: ParticipantRole | null;
  viewerStatus: ParticipantStatus | null;
  participantCount: number;
  approvedClipCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectParticipantDTO {
  id: string;
  projectId: string;
  userId: string;
  username: string;
  displayName: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  invitedBy: string | null;
  createdAt: string;
}

export interface ProjectContributionDTO {
  id: string;
  projectId: string;
  contributorId: string;
  contributorUsername: string;
  contributorDisplayName: string;
  sourcePostId: string | null;
  hasMedia: boolean;
  mediaType: ContributionMediaType;
  mediaMetadata: {
    mimeType: string;
    sizeBytes: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
  };
  caption: string | null;
  aiDisclosureStatus: AiDisclosureStatus;
  aiDisclosureDetails: string | null;
  aiDisclosedAt: string | null;
  provenanceStatus: ProvenanceStatus;
  consentGranted: boolean;
  consentGrantedAt: string | null;
  consentPolicyVersion: string;
  consentWithdrawnAt: string | null;
  withdrawalReason: string | null;
  reviewStatus: ContributionReviewStatus;
  reviewedAt: string | null;
  reviewNote: string | null;
  sequenceOrder: number | null;
  createdAt: string;
}

export interface ProjectRenderJobDTO {
  id: string;
  projectId: string;
  requestedBy: string | null;
  idempotencyKey: string;
  status: RenderJobStatus;
  clipCount: number;
  manifestSummary: Array<{
    contributionId: string;
    contributorId: string;
    mediaType: ContributionMediaType;
    sequenceOrder: number;
    consentPolicyVersion: string;
    aiDisclosureStatus: AiDisclosureStatus;
  }>;
  hasOutputMedia: boolean;
  outputProvenance: CollaborativeOutputProvenance | null;
  attemptCount: number;
  maxAttempts: number;
  timeoutSeconds: number;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
