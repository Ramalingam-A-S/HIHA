import { z } from "zod";

export const FOLLOW_PERMISSION_VALUES = [
  "everyone",
  "approval_required",
  "nobody",
] as const;
export type FollowPermission = (typeof FOLLOW_PERMISSION_VALUES)[number];

export const INTERACTION_PERMISSION_VALUES = [
  "everyone",
  "followers_only",
  "nobody",
] as const;
export type InteractionPermission =
  (typeof INTERACTION_PERMISSION_VALUES)[number];

export const DEFAULT_POST_VISIBILITY_VALUES = [
  "public",
  "followers",
  "private",
] as const;
export type DefaultPostVisibility =
  (typeof DEFAULT_POST_VISIBILITY_VALUES)[number];

export const AGE_SAFETY_MODE_VALUES = ["standard", "teen_13_17"] as const;
export type AgeSafetyMode = (typeof AGE_SAFETY_MODE_VALUES)[number];

export const AGE_ASSURANCE_STATUS_VALUES = [
  "unverified",
  "self_attested",
  "provider_verified",
] as const;
export type AgeAssuranceStatus = (typeof AGE_ASSURANCE_STATUS_VALUES)[number];

export const ACCOUNT_DELETION_MODE_VALUES = [
  "deactivate_and_scrub",
  "permanent_delete",
] as const;
export type AccountDeletionMode = (typeof ACCOUNT_DELETION_MODE_VALUES)[number];

export const CURRENT_PRIVACY_POLICY_VERSION = "v1.0-2026-10";

export const FOLLOW_PERMISSION_LABELS: Record<
  FollowPermission,
  { label: string; description: string }
> = {
  everyone: {
    label: "Everyone (Immediate if Public)",
    description:
      "Public accounts accept followers immediately; private accounts still require your approval.",
  },
  approval_required: {
    label: "Approval Required",
    description:
      "All incoming follow requests start as pending and require your explicit approval, even if your profile is public.",
  },
  nobody: {
    label: "No New Followers",
    description:
      "Blocks all new incoming follow requests while keeping your existing accepted followers.",
  },
};

export const INTERACTION_PERMISSION_LABELS: Record<
  InteractionPermission,
  { label: string; description: string }
> = {
  everyone: {
    label: "Everyone who can view content",
    description:
      "Any non-blocked user who can view your post may like it or invite you to collaborative projects.",
  },
  followers_only: {
    label: "Accepted Followers Only",
    description:
      "Only accounts you have accepted as followers may like your posts or send you collaborative project invitations.",
  },
  nobody: {
    label: "No One (Interactions Disabled)",
    description:
      "Disables likes from other accounts and blocks incoming collaborative project invitations.",
  },
};

export const AGE_SAFETY_MODE_LABELS: Record<
  AgeSafetyMode,
  { badge: string; title: string; summary: string }
> = {
  standard: {
    badge: "Standard (18+ / General Eligibility)",
    title: "Standard Account Controls",
    summary:
      "You control whether your profile is public or private, who can follow you, and who can interact with your posts.",
  },
  teen_13_17: {
    badge: "Teen Protective Mode (Ages 13–17)",
    title: "Teen Protective Safety Mode",
    summary:
      "Enforces strict privacy defaults at the database level: private profile, hidden from public directory search, follow approval required, follower-only interactions, and non-public post/project visibility.",
  },
};

export interface PrivacyAndSafetySettingsInput {
  isPrivate: boolean;
  discoverableInSearch: boolean;
  followPermission: FollowPermission;
  interactionPermission: InteractionPermission;
  defaultPostVisibility: DefaultPostVisibility;
  notifyOnFollowRequest: boolean;
  notifyOnNewFollower: boolean;
  notifyOnFollowAccepted: boolean;
  ageSafetyMode: AgeSafetyMode;
}

/**
 * Pure deterministic helper that applies Teen Protective Safety Mode invariants
 * when `ageSafetyMode === 'teen_13_17'`.
 */
export function applyTeenSafetyModeDefaults(
  input: PrivacyAndSafetySettingsInput
): PrivacyAndSafetySettingsInput {
  if (input.ageSafetyMode !== "teen_13_17") {
    return { ...input };
  }

  return {
    ...input,
    isPrivate: true,
    discoverableInSearch: false,
    followPermission:
      input.followPermission === "nobody" ? "nobody" : "approval_required",
    interactionPermission:
      input.interactionPermission === "nobody" ? "nobody" : "followers_only",
    defaultPostVisibility:
      input.defaultPostVisibility === "private" ? "private" : "followers",
  };
}

export const updatePrivacySettingsSchema = z
  .object({
    isPrivate: z.boolean(),
    discoverableInSearch: z.boolean(),
    followPermission: z.enum(FOLLOW_PERMISSION_VALUES),
    interactionPermission: z.enum(INTERACTION_PERMISSION_VALUES),
    defaultPostVisibility: z.enum(DEFAULT_POST_VISIBILITY_VALUES),
    notifyOnFollowRequest: z.boolean(),
    notifyOnNewFollower: z.boolean(),
    notifyOnFollowAccepted: z.boolean(),
    ageSafetyMode: z.enum(AGE_SAFETY_MODE_VALUES),
    enforceStrictTeenValidation: z.boolean().optional().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.enforceStrictTeenValidation && val.ageSafetyMode === "teen_13_17") {
      if (!val.isPrivate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["isPrivate"],
          message:
            "Teen Protective Safety Mode requires your profile to remain private.",
        });
      }
      if (val.discoverableInSearch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["discoverableInSearch"],
          message:
            "Teen Protective Safety Mode disables public directory search discoverability.",
        });
      }
      if (val.followPermission === "everyone") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["followPermission"],
          message:
            "Teen Protective Safety Mode requires follow approval or disabling new followers.",
        });
      }
      if (val.interactionPermission === "everyone") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["interactionPermission"],
          message:
            "Teen Protective Safety Mode restricts interactions and invitations to accepted followers or nobody.",
        });
      }
      if (val.defaultPostVisibility === "public") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["defaultPostVisibility"],
          message:
            "Teen Protective Safety Mode prohibits public-visibility posts; select followers-only or private.",
        });
      }
    }
  });

export const requestAccountDeletionSchema = z
  .object({
    mode: z.enum(ACCOUNT_DELETION_MODE_VALUES),
    confirmationPhrase: z.string().trim().min(1, "Confirmation phrase is required."),
    currentPassword: z
      .string()
      .min(1, "Current account password is required to confirm this action."),
  })
  .superRefine((val, ctx) => {
    const expected =
      val.mode === "deactivate_and_scrub"
        ? "DEACTIVATE MY ACCOUNT"
        : "DELETE MY ACCOUNT";
    if (val.confirmationPhrase !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmationPhrase"],
        message: `Please type "${expected}" exactly to confirm.`,
      });
    }
  });

export type RequestAccountDeletionInput = z.infer<
  typeof requestAccountDeletionSchema
>;

export const reactivateAccountSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name cannot be empty.")
    .max(60, "Display name must be at most 60 characters.")
    .optional(),
});

/**
 * Pure deterministic authorization check for whether `actorId` can follow `targetId`
 * and what the resulting follow status (`accepted` vs `pending`) must be.
 */
export function evaluateFollowPermission(params: {
  actorId: string;
  targetId: string;
  targetIsPrivate: boolean;
  targetFollowPermission: FollowPermission;
  targetAgeSafetyMode: AgeSafetyMode;
  isBlocked: boolean;
  isTargetDeactivated?: boolean;
  isActorDeactivated?: boolean;
}): {
  allowed: boolean;
  resultingStatus?: "accepted" | "pending";
  reason?: string;
} {
  if (params.actorId === params.targetId) {
    return { allowed: false, reason: "You cannot follow yourself." };
  }
  if (params.isActorDeactivated) {
    return {
      allowed: false,
      reason: "Deactivated accounts cannot follow other users.",
    };
  }
  if (params.isTargetDeactivated) {
    return {
      allowed: false,
      reason: "Target account is unavailable or deactivated.",
    };
  }
  if (params.isBlocked) {
    return {
      allowed: false,
      reason: "Cannot follow an account when a block relationship is active.",
    };
  }
  if (params.targetFollowPermission === "nobody") {
    return {
      allowed: false,
      reason: "This account has disabled new followers.",
    };
  }
  if (
    params.targetIsPrivate ||
    params.targetFollowPermission === "approval_required" ||
    params.targetAgeSafetyMode === "teen_13_17"
  ) {
    return {
      allowed: true,
      resultingStatus: "pending",
    };
  }
  return {
    allowed: true,
    resultingStatus: "accepted",
  };
}

/**
 * Pure deterministic authorization check for whether `actorId` can interact with
 * `targetId` (liking their posts or inviting them to a collaborative project).
 */
export function evaluateInteractionPermission(params: {
  actorId: string;
  targetId: string;
  targetInteractionPermission: InteractionPermission;
  targetAgeSafetyMode: AgeSafetyMode;
  isAcceptedFollower: boolean;
  isBlocked: boolean;
  isTargetDeactivated?: boolean;
  isActorDeactivated?: boolean;
  interactionType?: "like_post" | "project_invite";
}): {
  allowed: boolean;
  reason?: string;
} {
  if (params.isActorDeactivated) {
    return {
      allowed: false,
      reason: "Deactivated accounts cannot interact with content.",
    };
  }
  if (params.isTargetDeactivated) {
    return {
      allowed: false,
      reason: "Target account is unavailable or deactivated.",
    };
  }
  if (params.isBlocked) {
    return {
      allowed: false,
      reason: "Interaction is blocked by relationship restrictions.",
    };
  }
  // Creators can always like their own posts
  if (
    params.actorId === params.targetId &&
    params.interactionType !== "project_invite"
  ) {
    return { allowed: true };
  }
  if (params.targetInteractionPermission === "nobody") {
    return {
      allowed: false,
      reason:
        params.interactionType === "project_invite"
          ? "Target user has disabled collaborative project invitations."
          : "The creator has disabled interactions on their content.",
    };
  }
  if (
    params.targetInteractionPermission === "followers_only" ||
    params.targetAgeSafetyMode === "teen_13_17"
  ) {
    if (!params.isAcceptedFollower) {
      return {
        allowed: false,
        reason:
          params.interactionType === "project_invite"
            ? "Target user only accepts collaborative project invitations from their accepted followers."
            : "Only accepted followers can interact with this creator's content.",
      };
    }
  }
  return { allowed: true };
}

export interface PersonalDataExportPackage {
  schema_version: string;
  exported_at: string;
  account_id: string;
  retention_and_privacy_notice: {
    scope: string;
    redactions: string;
    moderation_retention_policy: string;
  };
  profile: Record<string, unknown> | null;
  topic_preferences: Array<Record<string, unknown>>;
  relationships: {
    following: Array<Record<string, unknown>>;
    followers: Array<Record<string, unknown>>;
    blocked_accounts: Array<Record<string, unknown>>;
    muted_accounts: Array<Record<string, unknown>>;
  };
  posts: Array<Record<string, unknown>>;
  post_likes: Array<Record<string, unknown>>;
  communities: {
    memberships: Array<Record<string, unknown>>;
    shared_posts: Array<Record<string, unknown>>;
  };
  collaborative_video: {
    owned_projects: Array<Record<string, unknown>>;
    participations: Array<Record<string, unknown>>;
    contributions_and_consents: Array<Record<string, unknown>>;
  };
  safety_and_moderation: {
    submitted_reports: Array<Record<string, unknown>>;
    moderation_actions_received: Array<Record<string, unknown>>;
    appeals_submitted: Array<Record<string, unknown>>;
  };
}

/**
 * Defensive server-side verifier and sanitizer for personal data export packages.
 * Ensures the export belongs strictly to `expectedAccountId` and strips any internal
 * staff reviewer identities (`reviewer_id`, `actor_id`, `reversed_by`) or raw storage paths.
 */
export function sanitizePersonalDataExport(
  raw: Record<string, unknown>,
  expectedAccountId: string
): PersonalDataExportPackage {
  if (!raw || typeof raw !== "object" || raw.account_id !== expectedAccountId) {
    throw new Error(
      "Security violation: export package account_id does not match authenticated user."
    );
  }

  const safety = (raw.safety_and_moderation ?? {}) as Record<string, unknown>;
  const sanitizeArray = (
    items: unknown,
    forbiddenKeys: readonly string[]
  ): Array<Record<string, unknown>> => {
    if (!Array.isArray(items)) return [];
    return items.map((entry) => {
      if (!entry || typeof entry !== "object") return {};
      const copy = { ...(entry as Record<string, unknown>) };
      for (const k of forbiddenKeys) {
        delete copy[k];
      }
      return copy;
    });
  };

  return {
    schema_version: String(raw.schema_version ?? "1.0-hiha-user-data-export"),
    exported_at: String(raw.exported_at ?? new Date().toISOString()),
    account_id: expectedAccountId,
    retention_and_privacy_notice: (raw.retention_and_privacy_notice as PersonalDataExportPackage["retention_and_privacy_notice"]) ?? {
      scope:
        "Contains only data owned by or directly associated with the authenticated account.",
      redactions:
        "Internal moderation reviewer identities, private third-party profile data, and raw storage signing secrets are excluded.",
      moderation_retention_policy:
        "Anonymized moderation enforcement audit records are retained in the safety ledger upon account deletion.",
    },
    profile:
      raw.profile && typeof raw.profile === "object"
        ? { ...(raw.profile as Record<string, unknown>) }
        : null,
    topic_preferences: sanitizeArray(raw.topic_preferences, []),
    relationships: {
      following: sanitizeArray(
        (raw.relationships as Record<string, unknown> | undefined)?.following,
        []
      ),
      followers: sanitizeArray(
        (raw.relationships as Record<string, unknown> | undefined)?.followers,
        []
      ),
      blocked_accounts: sanitizeArray(
        (raw.relationships as Record<string, unknown> | undefined)
          ?.blocked_accounts,
        []
      ),
      muted_accounts: sanitizeArray(
        (raw.relationships as Record<string, unknown> | undefined)
          ?.muted_accounts,
        []
      ),
    },
    posts: sanitizeArray(raw.posts, ["media_path"]),
    post_likes: sanitizeArray(raw.post_likes, []),
    communities: {
      memberships: sanitizeArray(
        (raw.communities as Record<string, unknown> | undefined)?.memberships,
        []
      ),
      shared_posts: sanitizeArray(
        (raw.communities as Record<string, unknown> | undefined)?.shared_posts,
        ["removed_by"]
      ),
    },
    collaborative_video: {
      owned_projects: sanitizeArray(
        (raw.collaborative_video as Record<string, unknown> | undefined)
          ?.owned_projects,
        ["output_media_path"]
      ),
      participations: sanitizeArray(
        (raw.collaborative_video as Record<string, unknown> | undefined)
          ?.participations,
        []
      ),
      contributions_and_consents: sanitizeArray(
        (raw.collaborative_video as Record<string, unknown> | undefined)
          ?.contributions_and_consents,
        ["media_path", "reviewed_by"]
      ),
    },
    safety_and_moderation: {
      submitted_reports: sanitizeArray(safety.submitted_reports, [
        "reviewer_id",
        "resolution_note",
      ]),
      moderation_actions_received: sanitizeArray(
        safety.moderation_actions_received,
        ["actor_id", "reversed_by"]
      ),
      appeals_submitted: sanitizeArray(safety.appeals_submitted, [
        "reviewer_id",
      ]),
    },
  };
}
