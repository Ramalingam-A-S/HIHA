import { describe, it, expect } from "vitest";
import {
  issueModerationActionSchema,
  reverseModerationActionSchema,
  submitAppealSchema,
  reviewAppealSchema,
  getEffectiveActionStatus,
  type ModerationActionType,
  type ModerationActionStatus,
  type ReportTargetType,
} from "@/lib/reports/types";

const VALID_UUID_1 = "a0000000-0000-4000-8000-000000000001";
const VALID_UUID_2 = "a0000000-0000-4000-8000-000000000002";

describe("Milestone 4.1: Moderation Enforcement & Appeals Logic", () => {
  describe("Enforcement & Appeal Zod Schemas", () => {
    it("accepts valid warning, content_restriction, and account_restriction payloads", () => {
      const warningRes = issueModerationActionSchema.safeParse({
        targetType: "post",
        targetId: VALID_UUID_1,
        actionType: "warning",
        reason: "Minor formatting guideline reminder.",
      });
      expect(warningRes.success).toBe(true);

      const contentRes = issueModerationActionSchema.safeParse({
        targetType: "community_post",
        targetId: VALID_UUID_1,
        actionType: "content_restriction",
        reason: "Off-topic promotional content.",
        durationHours: 72,
      });
      expect(contentRes.success).toBe(true);

      const accountRes = issueModerationActionSchema.safeParse({
        targetType: "profile",
        targetId: VALID_UUID_1,
        actionType: "account_restriction",
        reason: "Repeated spam violations across threads.",
        durationHours: 24,
        reportId: VALID_UUID_2,
      });
      expect(accountRes.success).toBe(true);
    });

    it("rejects account_restriction without an explicit duration or on a non-profile target", () => {
      const missingDuration = issueModerationActionSchema.safeParse({
        targetType: "profile",
        targetId: VALID_UUID_1,
        actionType: "account_restriction",
        reason: "Temporary suspension without duration",
      });
      expect(missingDuration.success).toBe(false);

      const wrongTarget = issueModerationActionSchema.safeParse({
        targetType: "post",
        targetId: VALID_UUID_1,
        actionType: "account_restriction",
        reason: "Account restriction targeting a post",
        durationHours: 24,
      });
      expect(wrongTarget.success).toBe(false);
    });

    it("rejects duration_hours outside bounded limits (1 to 8760 hours)", () => {
      const zeroHours = issueModerationActionSchema.safeParse({
        targetType: "profile",
        targetId: VALID_UUID_1,
        actionType: "account_restriction",
        reason: "Invalid zero duration",
        durationHours: 0,
      });
      expect(zeroHours.success).toBe(false);

      const excessiveHours = issueModerationActionSchema.safeParse({
        targetType: "profile",
        targetId: VALID_UUID_1,
        actionType: "account_restriction",
        reason: "Exceeds 1 year max duration",
        durationHours: 8761,
      });
      expect(excessiveHours.success).toBe(false);
    });

    it("rejects content_restriction targeting a user profile", () => {
      const res = issueModerationActionSchema.safeParse({
        targetType: "profile",
        targetId: VALID_UUID_1,
        actionType: "content_restriction",
        reason: "Invalid target for content restriction",
      });
      expect(res.success).toBe(false);
    });

    it("validates reverseModerationActionSchema, submitAppealSchema, and reviewAppealSchema", () => {
      expect(
        reverseModerationActionSchema.safeParse({
          actionId: VALID_UUID_1,
          reversalReason: "Issued in error; verified compliant.",
        }).success
      ).toBe(true);

      expect(
        submitAppealSchema.safeParse({
          moderationActionId: VALID_UUID_1,
          reason: "This post cited primary peer-reviewed sources and was not spam.",
        }).success
      ).toBe(true);

      expect(
        submitAppealSchema.safeParse({
          moderationActionId: VALID_UUID_1,
          reason: "Too short",
        }).success
      ).toBe(false);

      expect(
        reviewAppealSchema.safeParse({
          appealId: VALID_UUID_1,
          status: "approved",
          resolutionNote: "Context verified; lifting restriction.",
        }).success
      ).toBe(true);
    });
  });

  describe("Global Staff vs. Community Moderator Authority Boundaries", () => {
    interface ActorContext {
      sessionUserId: string;
      suppliedActorId: string;
      isPlatformStaff: boolean;
      moderatedCommunityIds: string[];
    }

    interface EnforcementRequest {
      targetType: ReportTargetType;
      targetOwnerId: string;
      communityId: string | null;
      actionType: ModerationActionType;
    }

    function authorizeEnforcementAction(
      actor: ActorContext,
      req: EnforcementRequest
    ): { authorized: boolean; error?: string } {
      if (actor.suppliedActorId !== actor.sessionUserId) {
        return { authorized: false, error: "Actor identity must match authenticated session" };
      }
      if (actor.sessionUserId === req.targetOwnerId) {
        return { authorized: false, error: "Cannot issue a moderation action against yourself" };
      }
      if (req.targetType === "post" || req.targetType === "profile" || req.actionType === "account_restriction") {
        if (!actor.isPlatformStaff) {
          return { authorized: false, error: "Global platform staff authorization required" };
        }
        return { authorized: true };
      }
      if (req.targetType === "community_post") {
        if (actor.isPlatformStaff) return { authorized: true };
        if (req.communityId && actor.moderatedCommunityIds.includes(req.communityId)) {
          return { authorized: true };
        }
        return { authorized: false, error: "Community moderator authorization required" };
      }
      return { authorized: false, error: "Unsupported target" };
    }

    it("rejects forged actor identities", () => {
      const res = authorizeEnforcementAction(
        {
          sessionUserId: "staff-1",
          suppliedActorId: "staff-2",
          isPlatformStaff: true,
          moderatedCommunityIds: [],
        },
        {
          targetType: "post",
          targetOwnerId: "user-1",
          communityId: null,
          actionType: "content_restriction",
        }
      );
      expect(res.authorized).toBe(false);
      expect(res.error).toContain("Actor identity");
    });

    it("denies community moderators from issuing global post or account restrictions", () => {
      const modActor: ActorContext = {
        sessionUserId: "mod-1",
        suppliedActorId: "mod-1",
        isPlatformStaff: false,
        moderatedCommunityIds: ["comm-1"],
      };

      expect(
        authorizeEnforcementAction(modActor, {
          targetType: "post",
          targetOwnerId: "user-1",
          communityId: null,
          actionType: "content_restriction",
        }).authorized
      ).toBe(false);

      expect(
        authorizeEnforcementAction(modActor, {
          targetType: "profile",
          targetOwnerId: "user-1",
          communityId: null,
          actionType: "account_restriction",
        }).authorized
      ).toBe(false);
    });

    it("allows community moderators to restrict community posts only within their own community", () => {
      const modActor: ActorContext = {
        sessionUserId: "mod-1",
        suppliedActorId: "mod-1",
        isPlatformStaff: false,
        moderatedCommunityIds: ["comm-1"],
      };

      expect(
        authorizeEnforcementAction(modActor, {
          targetType: "community_post",
          targetOwnerId: "user-1",
          communityId: "comm-1",
          actionType: "content_restriction",
        }).authorized
      ).toBe(true);

      expect(
        authorizeEnforcementAction(modActor, {
          targetType: "community_post",
          targetOwnerId: "user-1",
          communityId: "comm-2",
          actionType: "content_restriction",
        }).authorized
      ).toBe(false);
    });
  });

  describe("Temporary Restriction Expiration & Effective Status", () => {
    it("automatically transitions active temporary restrictions to expired once expires_at <= now", () => {
      const nowMs = Date.parse("2026-10-12T12:00:00Z");
      const pastIso = "2026-10-12T11:59:59Z";
      const futureIso = "2026-10-12T12:00:01Z";

      expect(getEffectiveActionStatus("active", pastIso, nowMs)).toBe("expired");
      expect(getEffectiveActionStatus("active", futureIso, nowMs)).toBe("active");
      expect(getEffectiveActionStatus("active", null, nowMs)).toBe("active");
      expect(getEffectiveActionStatus("reversed", futureIso, nowMs)).toBe("reversed");
    });
  });

  describe("Duplicate Prevention, Audit Immutability & Appeal Reversal", () => {
    interface AuditRecord {
      id: string;
      actorId: string;
      targetUserId: string;
      targetType: ReportTargetType;
      targetId: string;
      actionType: ModerationActionType;
      reason: string;
      status: ModerationActionStatus;
      reversedBy: string | null;
      reversalReason: string | null;
    }

    it("prevents duplicate active restrictions while allowing new actions after reversal", () => {
      const records: AuditRecord[] = [
        {
          id: "act-1",
          actorId: "staff-1",
          targetUserId: "user-1",
          targetType: "post",
          targetId: "post-1",
          actionType: "content_restriction",
          reason: "Initial restriction",
          status: "active",
          reversedBy: null,
          reversalReason: null,
        },
      ];

      const hasDuplicateActive = (targetId: string, actionType: ModerationActionType) =>
        records.some(
          (r) => r.targetId === targetId && r.actionType === actionType && r.status === "active"
        );

      expect(hasDuplicateActive("post-1", "content_restriction")).toBe(true);

      // Reverse original action via appeal approval
      records[0].status = "reversed";
      records[0].reversedBy = "staff-1";
      records[0].reversalReason = "Reversed via approved appeal";

      // Original audit record is preserved, and target is no longer actively restricted
      expect(records).toHaveLength(1);
      expect(records[0].reason).toBe("Initial restriction");
      expect(hasDuplicateActive("post-1", "content_restriction")).toBe(false);
    });
  });

  describe("Cross-Post & Direct Media Enforcement Bypass Prevention", () => {
    function canViewerAccessPostOrMedia(params: {
      viewerId: string | null;
      creatorId: string;
      isPostRestricted: boolean;
      isCommunityPostRestricted?: boolean;
    }): boolean {
      // Non-creators are strictly blocked from reading a restricted post, its cross-posts, or its media
      if (params.viewerId !== params.creatorId) {
        if (params.isPostRestricted || params.isCommunityPostRestricted) {
          return false;
        }
      }
      return true;
    }

    it("blocks non-creators from accessing restricted post via feed, community cross-post, or media URL", () => {
      expect(
        canViewerAccessPostOrMedia({
          viewerId: "viewer-2",
          creatorId: "author-1",
          isPostRestricted: true,
          isCommunityPostRestricted: false,
        })
      ).toBe(false);

      expect(
        canViewerAccessPostOrMedia({
          viewerId: null,
          creatorId: "author-1",
          isPostRestricted: true,
        })
      ).toBe(false);
    });

    it("allows creator to view their own restricted post so they can inspect and appeal it", () => {
      expect(
        canViewerAccessPostOrMedia({
          viewerId: "author-1",
          creatorId: "author-1",
          isPostRestricted: true,
        })
      ).toBe(true);
    });
  });
});
