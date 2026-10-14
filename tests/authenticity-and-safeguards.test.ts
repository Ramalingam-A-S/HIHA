import { describe, it, expect } from "vitest";
import {
  aiDisclosureStatusSchema,
  aiDisclosureDetailsSchema,
  getAuthenticityDisplayInfo,
  parseCollaborativeOutputProvenance,
  formatCollaborativeProvenanceSummary,
  applyCreatorVelocityDampener,
} from "@/lib/authenticity/types";
import { createPostSchema, updatePostSchema } from "@/lib/validations/posts";
import {
  submitContributionSchema,
  CURRENT_CONSENT_POLICY_VERSION,
} from "@/lib/collaboration/types";
import {
  scoreCandidate,
  MAX_EVALUATED_INTERESTS_PER_POST,
  type ContentCandidate,
  type UserInterestPreference,
} from "@/lib/recommendation/scorer";

describe("Milestone 4.3: AI Content Transparency, Provenance & Anti-Manipulation Safeguards", () => {
  describe("1. Content Disclosure Validation & Non-Accusatory Display Model", () => {
    it("distinguishes 'not_declared' from 'no_ai_declared' and 'machine_verified' without claiming proof of human creation", () => {
      const undeclared = getAuthenticityDisplayInfo("not_declared", "unverified");
      expect(undeclared.isDeclared).toBe(false);
      expect(undeclared.isMachineVerified).toBe(false);
      expect(undeclared.badgeLabel).toBe("Origin not declared");
      expect(undeclared.provenanceLabel).toBe("Unverified origin (no declaration)");
      expect(undeclared.description).toContain(
        "Lack of a declaration is not proof that content is human-created or unaltered"
      );

      const selfDeclaredHuman = getAuthenticityDisplayInfo(
        "no_ai_declared",
        "creator_declared"
      );
      expect(selfDeclaredHuman.isDeclared).toBe(true);
      expect(selfDeclaredHuman.isMachineVerified).toBe(false);
      expect(selfDeclaredHuman.badgeLabel).toBe("Self-declared: No AI used");
      expect(selfDeclaredHuman.provenanceLabel).toBe(
        "Creator self-declaration (unverified)"
      );
      expect(selfDeclaredHuman.description).toContain(
        "not independent proof of origin"
      );

      const machineVerifiedHuman = getAuthenticityDisplayInfo(
        "no_ai_declared",
        "machine_verified"
      );
      expect(machineVerifiedHuman.isDeclared).toBe(true);
      expect(machineVerifiedHuman.isMachineVerified).toBe(true);
      expect(machineVerifiedHuman.badgeLabel).toBe(
        "Verified provenance · No AI declared"
      );
      expect(machineVerifiedHuman.provenanceLabel).toBe(
        "System-verified provenance"
      );
      expect(machineVerifiedHuman.tone).toBe("emerald");
    });

    it("provides clear, non-accusatory labels for AI-generated, AI-assisted, and materially altered content", () => {
      const aiGen = getAuthenticityDisplayInfo(
        "ai_generated",
        "creator_declared",
        "Generated via Sora / Runway"
      );
      expect(aiGen.badgeLabel).toBe("Declared: AI-generated");
      expect(aiGen.tone).toBe("amber");
      expect(aiGen.details).toBe("Generated via Sora / Runway");

      const aiAssist = getAuthenticityDisplayInfo(
        "ai_assisted",
        "creator_declared"
      );
      expect(aiAssist.badgeLabel).toBe("Declared: AI-assisted / edited");
      expect(aiAssist.tone).toBe("amber");

      const altered = getAuthenticityDisplayInfo(
        "material_alteration",
        "creator_declared"
      );
      expect(altered.badgeLabel).toBe("Declared: Materially altered");
      expect(altered.tone).toBe("amber");
    });

    it("validates AI disclosure fields on post creation, post editing, and collaborative clip submission", () => {
      expect(aiDisclosureStatusSchema.safeParse("ai_generated").success).toBe(true);
      expect(aiDisclosureStatusSchema.safeParse("forged_status").success).toBe(false);

      expect(
        aiDisclosureDetailsSchema.safeParse("Edited sky replacement in DaVinci").success
      ).toBe(true);
      expect(aiDisclosureDetailsSchema.safeParse("x".repeat(501)).success).toBe(false);

      const validPost = createPostSchema.safeParse({
        content_type: "text",
        caption: "Testing AI transparency",
        ai_disclosure_status: "ai_assisted",
        ai_disclosure_details: "Used grammar and tone refinement tools",
      });
      expect(validPost.success).toBe(true);

      const defaultPost = createPostSchema.safeParse({
        content_type: "text",
        caption: "Standard post without explicit disclosure",
      });
      expect(defaultPost.success).toBe(true);
      if (defaultPost.success) {
        expect(defaultPost.data.ai_disclosure_status).toBe("not_declared");
      }

      // Details without declaring a status other than not_declared should be rejected
      const invalidUndeclaredDetails = createPostSchema.safeParse({
        content_type: "text",
        caption: "Undeclared with details",
        ai_disclosure_status: "not_declared",
        ai_disclosure_details: "Some details without status",
      });
      expect(invalidUndeclaredDetails.success).toBe(false);

      const validUpdate = updatePostSchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        ai_disclosure_status: "material_alteration",
        ai_disclosure_details: "Composite splice of two takes",
      });
      expect(validUpdate.success).toBe(true);

      const validContribution = submitContributionSchema.safeParse({
        projectId: "11111111-1111-4111-8111-111111111111",
        mediaPath: "11111111-1111-4111-8111-111111111111/clip.mp4",
        mediaType: "short_video",
        mediaMetadata: { mimeType: "video/mp4", sizeBytes: 20480 },
        consentGranted: true,
        consentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION,
        aiDisclosureStatus: "ai_generated",
        aiDisclosureDetails: "Synthesized intro transition",
      });
      expect(validContribution.success).toBe(true);
    });
  });

  describe("2. Collaborative Video Output Provenance", () => {
    it("parses and formats privacy-safe composite provenance summaries without exposing contributor identities", () => {
      const rawProvenance = {
        schema_version: "1.0",
        render_job_id: "22222222-2222-4222-8222-222222222222",
        rendered_at: "2026-10-12T18:00:00Z",
        total_included_clips: 3,
        has_declared_ai_or_alteration: true,
        has_undeclared_clips: true,
        provenance_status: "creator_declared",
        disclosure_breakdown: {
          not_declared: 1,
          no_ai_declared: 1,
          ai_generated: 1,
          ai_assisted: 0,
          material_alteration: 0,
        },
        included_sequences: [
          { sequence_order: 1, ai_disclosure_status: "no_ai_declared" },
          { sequence_order: 2, ai_disclosure_status: "ai_generated" },
          { sequence_order: 3, ai_disclosure_status: "not_declared" },
        ],
      };

      const parsed = parseCollaborativeOutputProvenance(rawProvenance);
      expect(parsed).not.toBeNull();
      expect(parsed?.total_included_clips).toBe(3);
      expect(parsed?.has_declared_ai_or_alteration).toBe(true);
      expect(parsed?.has_undeclared_clips).toBe(true);
      expect(parsed?.disclosure_breakdown.ai_generated).toBe(1);
      expect(parsed?.disclosure_breakdown.no_ai_declared).toBe(1);
      expect(parsed?.disclosure_breakdown.not_declared).toBe(1);

      const summary = formatCollaborativeProvenanceSummary(parsed!);
      expect(summary.headline).toContain("3 stitched clips");
      expect(summary.headline).toContain("Includes declared AI or material edits");
      expect(summary.detailLine).toContain("1 AI-generated");
      expect(summary.detailLine).toContain("1 self-declared no AI");
      expect(summary.detailLine).toContain("1 undeclared origin");
      expect(summary.tone).toBe("amber");
    });

    it("returns null for malformed or missing provenance objects", () => {
      expect(parseCollaborativeOutputProvenance(null)).toBeNull();
      expect(parseCollaborativeOutputProvenance({})).toBeNull();
      expect(parseCollaborativeOutputProvenance({ total_included_clips: 2 })).toBeNull();
    });
  });

  describe("3. Manipulated-Engagement & Ranking Anti-Abuse Safeguards", () => {
    it("caps evaluated interest tags per post and deduplicates repeated tags to prevent tag-stuffing manipulation", () => {
      const userPreferences: UserInterestPreference[] = [
        { slug: "t1", category: "technology-science", priority: 5 },
        { slug: "t2", category: "technology-science", priority: 5 },
        { slug: "t3", category: "technology-science", priority: 5 },
        { slug: "t4", category: "technology-science", priority: 5 },
        { slug: "t5", category: "technology-science", priority: 5 },
        { slug: "t6", category: "technology-science", priority: 5 },
        { slug: "t7", category: "technology-science", priority: 5 },
      ];

      const fiveTagPost: ContentCandidate = {
        id: "post-5",
        title: "Normal 5-tag post",
        primaryCategory: "technology-science",
        interestSlugs: ["t1", "t2", "t3", "t4", "t5"],
        isSafetyEligible: true,
      };

      // Post attempting to stuff 7 matching tags and duplicate tags
      const stuffedPost: ContentCandidate = {
        id: "post-stuffed",
        title: "Stuffed post",
        primaryCategory: "technology-science",
        interestSlugs: ["t1", "t1", "t2", "t3", "t4", "t5", "t6", "t7"],
        isSafetyEligible: true,
      };

      expect(MAX_EVALUATED_INTERESTS_PER_POST).toBe(5);
      const scoreFive = scoreCandidate(fiveTagPost, userPreferences);
      const scoreStuffed = scoreCandidate(stuffedPost, userPreferences);

      // Stuffing beyond 5 tags or repeating tags yields zero extra score boost
      expect(scoreStuffed.score).toBe(scoreFive.score);
      expect(scoreStuffed.matchedInterests).toHaveLength(5);
      expect(
        scoreStuffed.reasons.some((r) => r.includes("Tag-stuffing safeguard"))
      ).toBe(true);
    });

    it("dampens rapid consecutive posts from the same creator in ranked feeds so a burst cannot monopolize top slots", () => {
      const items = [
        {
          id: "f1",
          creatorId: "flooder",
          score: 100,
          publishedAt: "2026-10-12T12:04:00Z",
          explanationDetails: ["Base score"],
        },
        {
          id: "f2",
          creatorId: "flooder",
          score: 99,
          publishedAt: "2026-10-12T12:03:00Z",
          explanationDetails: ["Base score"],
        },
        {
          id: "f3",
          creatorId: "flooder",
          score: 98,
          publishedAt: "2026-10-12T12:02:00Z",
          explanationDetails: ["Base score"],
        },
        {
          id: "f4",
          creatorId: "flooder",
          score: 97,
          publishedAt: "2026-10-12T12:01:00Z",
          explanationDetails: ["Base score"],
        },
        {
          id: "n1",
          creatorId: "normal-creator",
          score: 80,
          publishedAt: "2026-10-12T12:00:00Z",
          explanationDetails: ["Base score"],
        },
      ];

      const dampened = applyCreatorVelocityDampener(items);

      // 1st (100) and 2nd (99) keep 1.0x; 3rd gets 0.85x (83.3); 4th gets 0.70x (67.9 < 80 for n1)
      expect(dampened.map((i) => i.id)).toEqual(["f1", "f2", "f3", "n1", "f4"]);
      const fourthPost = dampened.find((i) => i.id === "f4")!;
      expect(fourthPost.score).toBe(67.9);
      expect(
        fourthPost.explanationDetails.some((d) =>
          d.includes("Creator frequency safeguard applied")
        )
      ).toBe(true);
    });
  });
});
