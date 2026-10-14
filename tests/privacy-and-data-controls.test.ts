import { describe, it, expect } from "vitest";
import {
  updatePrivacySettingsSchema,
  requestAccountDeletionSchema,
  applyTeenSafetyModeDefaults,
  evaluateFollowPermission,
  evaluateInteractionPermission,
  sanitizePersonalDataExport,
} from "@/lib/privacy/types";
import {
  SelfAttestationAgeAdapter,
  defaultAgeAssuranceProvider,
} from "@/lib/privacy/age-assurance";
import { signUpSchema } from "@/lib/validations/auth";

describe("Milestone 4.4 — Privacy, Child Safety & Personal Data Controls", () => {
  describe("Account Privacy & Teen 13–17 Safety Mode Normalization", () => {
    it("enforces protective defaults when Teen 13–17 Safety Mode is selected", () => {
      const parsed = updatePrivacySettingsSchema.parse({
        isPrivate: false,
        discoverableInSearch: true,
        followPermission: "everyone",
        interactionPermission: "everyone",
        defaultPostVisibility: "public",
        ageSafetyMode: "teen_13_17",
        notifyOnFollowRequest: true,
        notifyOnNewFollower: true,
        notifyOnFollowAccepted: true,
      });

      const normalized = applyTeenSafetyModeDefaults(parsed);
      expect(normalized.isPrivate).toBe(true);
      expect(normalized.discoverableInSearch).toBe(false);
      expect(normalized.followPermission).toBe("approval_required");
      expect(normalized.interactionPermission).toBe("followers_only");
      expect(normalized.defaultPostVisibility).toBe("followers");
    });

    it("preserves stricter settings ('nobody' / 'private') in Teen 13–17 Safety Mode", () => {
      const parsed = updatePrivacySettingsSchema.parse({
        isPrivate: false,
        discoverableInSearch: true,
        followPermission: "nobody",
        interactionPermission: "nobody",
        defaultPostVisibility: "private",
        ageSafetyMode: "teen_13_17",
        notifyOnFollowRequest: false,
        notifyOnNewFollower: false,
        notifyOnFollowAccepted: false,
      });

      const normalized = applyTeenSafetyModeDefaults(parsed);
      expect(normalized.isPrivate).toBe(true);
      expect(normalized.discoverableInSearch).toBe(false);
      expect(normalized.followPermission).toBe("nobody");
      expect(normalized.interactionPermission).toBe("nobody");
      expect(normalized.defaultPostVisibility).toBe("private");
    });

    it("rejects relaxing protective boundaries when enforceStrictTeenValidation is enabled", () => {
      const strictRejected = updatePrivacySettingsSchema.safeParse({
        isPrivate: false,
        discoverableInSearch: true,
        followPermission: "everyone",
        interactionPermission: "everyone",
        defaultPostVisibility: "public",
        ageSafetyMode: "teen_13_17",
        notifyOnFollowRequest: true,
        notifyOnNewFollower: true,
        notifyOnFollowAccepted: true,
        enforceStrictTeenValidation: true,
      });
      expect(strictRejected.success).toBe(false);
    });
  });

  describe("Follow & Interaction Permission Evaluators", () => {
    it("evaluates follow permissions across public, approval_required, teen mode, nobody, and deactivated states", () => {
      expect(
        evaluateFollowPermission({
          actorId: "user-1",
          targetId: "user-2",
          targetIsPrivate: false,
          targetFollowPermission: "everyone",
          targetAgeSafetyMode: "standard",
          isBlocked: false,
        })
      ).toEqual({ allowed: true, resultingStatus: "accepted" });

      expect(
        evaluateFollowPermission({
          actorId: "user-1",
          targetId: "user-2",
          targetIsPrivate: false,
          targetFollowPermission: "approval_required",
          targetAgeSafetyMode: "standard",
          isBlocked: false,
        })
      ).toEqual({ allowed: true, resultingStatus: "pending" });

      expect(
        evaluateFollowPermission({
          actorId: "user-1",
          targetId: "user-2",
          targetIsPrivate: false,
          targetFollowPermission: "everyone",
          targetAgeSafetyMode: "teen_13_17",
          isBlocked: false,
        })
      ).toEqual({ allowed: true, resultingStatus: "pending" });

      const closed = evaluateFollowPermission({
        actorId: "user-1",
        targetId: "user-2",
        targetIsPrivate: false,
        targetFollowPermission: "nobody",
        targetAgeSafetyMode: "standard",
        isBlocked: false,
      });
      expect(closed.allowed).toBe(false);
      expect(closed.reason).toContain("disabled new followers");

      const deactivated = evaluateFollowPermission({
        actorId: "user-1",
        targetId: "user-2",
        targetIsPrivate: false,
        targetFollowPermission: "everyone",
        targetAgeSafetyMode: "standard",
        isBlocked: false,
        isTargetDeactivated: true,
      });
      expect(deactivated.allowed).toBe(false);
      expect(deactivated.reason).toContain("deactivated");
    });

    it("evaluates content & collaboration interaction permissions consistently", () => {
      // Self post like is always allowed
      expect(
        evaluateInteractionPermission({
          actorId: "user-1",
          targetId: "user-1",
          targetInteractionPermission: "nobody",
          targetAgeSafetyMode: "standard",
          isAcceptedFollower: false,
          isBlocked: false,
          interactionType: "like_post",
        })
      ).toEqual({ allowed: true });

      // Blocked users are never allowed
      expect(
        evaluateInteractionPermission({
          actorId: "user-2",
          targetId: "user-1",
          targetInteractionPermission: "everyone",
          targetAgeSafetyMode: "standard",
          isAcceptedFollower: true,
          isBlocked: true,
        }).allowed
      ).toBe(false);

      // Followers only blocks non-followers and allows accepted followers
      expect(
        evaluateInteractionPermission({
          actorId: "user-2",
          targetId: "user-1",
          targetInteractionPermission: "followers_only",
          targetAgeSafetyMode: "standard",
          isAcceptedFollower: false,
          isBlocked: false,
        }).allowed
      ).toBe(false);

      expect(
        evaluateInteractionPermission({
          actorId: "user-2",
          targetId: "user-1",
          targetInteractionPermission: "followers_only",
          targetAgeSafetyMode: "standard",
          isAcceptedFollower: true,
          isBlocked: false,
        }).allowed
      ).toBe(true);

      // Nobody blocks even accepted followers
      expect(
        evaluateInteractionPermission({
          actorId: "user-2",
          targetId: "user-1",
          targetInteractionPermission: "nobody",
          targetAgeSafetyMode: "standard",
          isAcceptedFollower: true,
          isBlocked: false,
          interactionType: "project_invite",
        }).allowed
      ).toBe(false);
    });
  });

  describe("Privacy-Preserving Age Assurance Boundary", () => {
    it("records minimum-age self-attestation without claiming third-party legal age verification or storing birth dates", () => {
      expect(defaultAgeAssuranceProvider).toBeInstanceOf(
        SelfAttestationAgeAdapter
      );

      const attested = defaultAgeAssuranceProvider.evaluateSelfAttestation({
        minimumAgeConfirmed: true,
        requestedSafetyMode: "teen_13_17",
      });
      expect(attested.eligibleForPlatform).toBe(true);
      expect(attested.assuranceStatus).toBe("self_attested");
      expect(attested.recommendedSafetyMode).toBe("teen_13_17");
      expect(attested.verifiedByExternalProvider).toBe(false);
      expect(attested.disclosureNotice).toContain(
        "does not constitute third-party legal age verification"
      );

      const unattested = defaultAgeAssuranceProvider.evaluateSelfAttestation({
        minimumAgeConfirmed: false,
        requestedSafetyMode: "standard",
      });
      expect(unattested.eligibleForPlatform).toBe(false);
      expect(unattested.assuranceStatus).toBe("unverified");
      expect(unattested.verifiedByExternalProvider).toBe(false);
    });

    it("validates zero-knowledge external age-bracket tokens without storing birth dates", () => {
      const nowMs = Date.parse("2026-10-13T00:00:00Z");

      // Under-13 bracket is rejected
      const under13 = defaultAgeAssuranceProvider.evaluateExternalToken(
        {
          subjectUserId: "user-1",
          ageBracket: "under_13",
          providerIssuer: "zk-age-provider",
          issuedAtIso: "2026-10-12T00:00:00Z",
          expiresAtIso: "2026-10-14T00:00:00Z",
          signatureVerified: true,
        },
        "user-1",
        nowMs
      );
      expect(under13.eligibleForPlatform).toBe(false);

      // Unverified signature or mismatched subject is rejected
      const forged = defaultAgeAssuranceProvider.evaluateExternalToken(
        {
          subjectUserId: "user-1",
          ageBracket: "adult_18_plus",
          providerIssuer: "zk-age-provider",
          issuedAtIso: "2026-10-12T00:00:00Z",
          expiresAtIso: "2026-10-14T00:00:00Z",
          signatureVerified: false,
        },
        "user-1",
        nowMs
      );
      expect(forged.eligibleForPlatform).toBe(false);
      expect(forged.assuranceStatus).toBe("unverified");
    });

    it("validates minimumAgeAttested and ageSafetyMode in signUpSchema", () => {
      const rejected = signUpSchema.safeParse({
        email: "teen@example.com",
        password: "Password123!",
        username: "teen_creator",
        displayName: "Teen Creator",
        minimumAgeAttested: false,
        ageSafetyMode: "teen_13_17",
      });
      expect(rejected.success).toBe(false);

      const accepted = signUpSchema.safeParse({
        email: "teen@example.com",
        password: "Password123!",
        username: "teen_creator",
        displayName: "Teen Creator",
        minimumAgeAttested: true,
        ageSafetyMode: "teen_13_17",
      });
      expect(accepted.success).toBe(true);
      if (accepted.success) {
        expect(accepted.data.ageSafetyMode).toBe("teen_13_17");
        expect(accepted.data.minimumAgeAttested).toBe(true);
      }
    });
  });

  describe("Personal Data Export Sanitization & Account Deletion Safeguards", () => {
    it("requires matching confirmation phrase and password for account deactivation or permanent deletion", () => {
      expect(
        requestAccountDeletionSchema.safeParse({
          mode: "deactivate_and_scrub",
          currentPassword: "Password123!",
          confirmationPhrase: "DELETE MY ACCOUNT",
        }).success
      ).toBe(false);

      expect(
        requestAccountDeletionSchema.safeParse({
          mode: "deactivate_and_scrub",
          currentPassword: "Password123!",
          confirmationPhrase: "DEACTIVATE MY ACCOUNT",
        }).success
      ).toBe(true);

      expect(
        requestAccountDeletionSchema.safeParse({
          mode: "permanent_delete",
          currentPassword: "Password123!",
          confirmationPhrase: "DELETE MY ACCOUNT",
        }).success
      ).toBe(true);
    });

    it("blocks cross-user personal data export packages and strips internal moderator IDs and storage paths", () => {
      const rawExport = {
        schema_version: "1.0-hiha-user-data-export",
        exported_at: new Date().toISOString(),
        account_id: "user-a",
        profile: { username: "alice", display_name: "Alice" },
        topic_preferences: [],
        relationships: {
          following: [],
          followers: [],
          blocked_accounts: [],
          muted_accounts: [],
        },
        posts: [
          {
            id: "post-1",
            caption: "My post",
            media_path: "user-a/secret-bucket-path.mp4",
          },
        ],
        post_likes: [],
        communities: { memberships: [], shared_posts: [] },
        collaborative_video: {
          owned_projects: [],
          participations: [],
          contributions_and_consents: [],
        },
        safety_and_moderation: {
          submitted_reports: [
            {
              id: "rep-1",
              reason: "spam",
              reviewer_id: "staff-secret-uuid",
              resolution_note: "internal staff note",
            },
          ],
          moderation_actions_received: [
            {
              id: "act-1",
              action_type: "warning",
              actor_id: "staff-secret-uuid",
            },
          ],
          appeals_submitted: [],
        },
      };

      // Throws when expectedAccountId does not match package account_id
      expect(() => sanitizePersonalDataExport(rawExport, "user-b")).toThrow(
        /Security violation/
      );

      // Accepts and strips forbidden internal fields when expectedAccountId matches
      const sanitized = sanitizePersonalDataExport(rawExport, "user-a");
      expect(sanitized.account_id).toBe("user-a");
      expect(sanitized.posts[0]).not.toHaveProperty("media_path");
      expect(
        sanitized.safety_and_moderation.submitted_reports[0]
      ).not.toHaveProperty("reviewer_id");
      expect(
        sanitized.safety_and_moderation.submitted_reports[0]
      ).not.toHaveProperty("resolution_note");
      expect(
        sanitized.safety_and_moderation.moderation_actions_received[0]
      ).not.toHaveProperty("actor_id");
    });
  });

  describe("P0-3 Storage & Lifecycle Deletion Invariants", () => {
    it("validates canonical stitched render output path structure strictly", async () => {
      const { defaultStorageProvider } = await import("@/lib/storage/supabase-storage");

      const validPath =
        "11111111-1111-1111-1111-111111111111/stitched-22222222-2222-2222-2222-222222222222-33333333-3333-3333-3333-333333333333-deadbeef.mp4";
      expect(defaultStorageProvider.validateCanonicalRenderOutputPath(validPath)).toBe(true);

      // Traversal attempt
      expect(
        defaultStorageProvider.validateCanonicalRenderOutputPath(
          "../11111111-1111-1111-1111-111111111111/stitched-22222222-2222-2222-2222-222222222222-33333333-3333-3333-3333-333333333333-deadbeef.mp4"
        )
      ).toBe(false);

      // Arbitrary non-stitched files
      expect(
        defaultStorageProvider.validateCanonicalRenderOutputPath(
          "11111111-1111-1111-1111-111111111111/normal-upload.mp4"
        )
      ).toBe(false);

      // Missing hex suffix or malformed UUIDs
      expect(
        defaultStorageProvider.validateCanonicalRenderOutputPath(
          "11111111-1111-1111-1111-111111111111/stitched-invalid-uuid-job-deadbeef.mp4"
        )
      ).toBe(false);
    });

    it("verifies user folder ownership scope prevents cross-user path manipulation", async () => {
      const { defaultStorageProvider } = await import("@/lib/storage/supabase-storage");

      const userA = "11111111-1111-1111-1111-111111111111";
      const userB = "22222222-2222-2222-2222-222222222222";

      expect(
        defaultStorageProvider.validatePathOwnership(
          userA,
          `${userA}/clip-1234.mp4`
        )
      ).toBe(true);

      // Cross-user path must fail ownership check
      expect(
        defaultStorageProvider.validatePathOwnership(
          userA,
          `${userB}/clip-1234.mp4`
        )
      ).toBe(false);
    });
  });
});
