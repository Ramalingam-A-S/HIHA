import { describe, it, expect } from "vitest";
import {
  createProjectSchema,
  updateProjectSchema,
  inviteParticipantSchema,
  submitContributionSchema,
  withdrawConsentSchema,
  reviewContributionSchema,
  reorderContributionsSchema,
  requestRenderSchema,
  CURRENT_CONSENT_POLICY_VERSION,
  type RenderManifestItem,
} from "@/lib/collaboration/types";
import {
  validateAndOrderRenderManifest,
  ContractQueueStitchingAdapter,
} from "@/lib/collaboration/render-provider";

const USER_A = "2a3020d5-a657-4999-bc4d-3af95e0de3a4";
const USER_B = "23e9a2c6-ff07-485c-baaf-57f88518c4f1";
const PROJ_ID = "11111111-2222-4333-8444-555555555555";
const CLIP_1 = "aaaa1111-2222-4333-8444-555555555551";
const CLIP_2 = "bbbb1111-2222-4333-8444-555555555552";

describe("Collaborative Projects & Video Stitching Schemas (Milestone 4.2)", () => {
  it("validates public and private project creation rules", () => {
    const validPublic = createProjectSchema.safeParse({
      title: "Global Solar Documentary",
      description: "Community clips from solar microgrid builders.",
      visibility: "public",
      participationMode: "open",
      status: "open",
    });
    expect(validPublic.success).toBe(true);

    // Private projects cannot use open participation mode
    const invalidPrivate = createProjectSchema.safeParse({
      title: "Secret Studio Cut",
      visibility: "private",
      participationMode: "open",
    });
    expect(invalidPrivate.success).toBe(false);

    const validPrivate = createProjectSchema.safeParse({
      title: "Secret Studio Cut",
      visibility: "private",
      participationMode: "invite_only",
    });
    expect(validPrivate.success).toBe(true);
  });

  it("rejects invalid project updates and enforces private invite_only rule", () => {
    const invalidUpdate = updateProjectSchema.safeParse({
      projectId: PROJ_ID,
      visibility: "private",
      participationMode: "open",
    });
    expect(invalidUpdate.success).toBe(false);

    const validUpdate = updateProjectSchema.safeParse({
      projectId: PROJ_ID,
      status: "locked",
    });
    expect(validUpdate.success).toBe(true);
  });

  it("enforces explicit usage consent and policy version on contribution submission", () => {
    const validClip = submitContributionSchema.safeParse({
      projectId: PROJ_ID,
      mediaPath: `${USER_A}/clip-intro-01.mp4`,
      mediaType: "short_video",
      mediaMetadata: {
        mimeType: "video/mp4",
        sizeBytes: 5 * 1024 * 1024,
        durationSeconds: 30,
      },
      caption: "Opening 30s segment",
      consentGranted: true,
      consentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION,
    });
    expect(validClip.success).toBe(true);

    // Blanket or missing consent is strictly rejected
    const missingConsent = submitContributionSchema.safeParse({
      projectId: PROJ_ID,
      mediaPath: `${USER_A}/clip-intro-01.mp4`,
      mediaType: "short_video",
      mediaMetadata: {
        mimeType: "video/mp4",
        sizeBytes: 5 * 1024 * 1024,
      },
      consentGranted: false,
      consentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION,
    });
    expect(missingConsent.success).toBe(false);

    // Policy version mismatch is rejected
    const wrongPolicy = submitContributionSchema.safeParse({
      projectId: PROJ_ID,
      mediaPath: `${USER_A}/clip-intro-01.mp4`,
      mediaType: "short_video",
      mediaMetadata: {
        mimeType: "video/mp4",
        sizeBytes: 5 * 1024 * 1024,
      },
      consentGranted: true,
      consentPolicyVersion: "v0.1-legacy",
    });
    expect(wrongPolicy.success).toBe(false);
  });

  it("rejects malformed upload paths, mismatched media types, and excessive durations", () => {
    // Path traversal or missing user UUID prefix
    const badPath = submitContributionSchema.safeParse({
      projectId: PROJ_ID,
      mediaPath: "../etc/passwd.mp4",
      mediaType: "short_video",
      mediaMetadata: {
        mimeType: "video/mp4",
        sizeBytes: 1024,
      },
      consentGranted: true,
      consentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION,
    });
    expect(badPath.success).toBe(false);

    // Image extension/MIME submitted as video contribution
    const imageAsVideo = submitContributionSchema.safeParse({
      projectId: PROJ_ID,
      mediaPath: `${USER_A}/photo.jpg`,
      mediaType: "short_video",
      mediaMetadata: {
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      },
      consentGranted: true,
      consentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION,
    });
    expect(imageAsVideo.success).toBe(false);

    // Short video exceeding 60s max duration
    const overDuration = submitContributionSchema.safeParse({
      projectId: PROJ_ID,
      mediaPath: `${USER_A}/clip.mp4`,
      mediaType: "short_video",
      mediaMetadata: {
        mimeType: "video/mp4",
        sizeBytes: 10 * 1024 * 1024,
        durationSeconds: 95,
      },
      consentGranted: true,
      consentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION,
    });
    expect(overDuration.success).toBe(false);
  });

  it("validates participant invitations, consent withdrawals, reviews, and sequence reordering", () => {
    expect(
      inviteParticipantSchema.safeParse({
        projectId: PROJ_ID,
        targetUserId: USER_B,
        role: "contributor",
      }).success
    ).toBe(true);

    expect(
      withdrawConsentSchema.safeParse({
        contributionId: CLIP_1,
        reason: "No longer wish to include this take",
      }).success
    ).toBe(true);

    expect(
      reviewContributionSchema.safeParse({
        contributionId: CLIP_1,
        decision: "approved",
        sequenceOrder: 1,
      }).success
    ).toBe(true);

    // Duplicate IDs in reorder array are rejected
    expect(
      reorderContributionsSchema.safeParse({
        projectId: PROJ_ID,
        orderedContributionIds: [CLIP_1, CLIP_1],
      }).success
    ).toBe(false);

    expect(
      reorderContributionsSchema.safeParse({
        projectId: PROJ_ID,
        orderedContributionIds: [CLIP_2, CLIP_1],
      }).success
    ).toBe(true);

    expect(
      requestRenderSchema.safeParse({
        projectId: PROJ_ID,
        idempotencyKey: "render-key-0001",
      }).success
    ).toBe(true);
  });

  it("validates and orders render manifests while rejecting unconsented or forged paths", () => {
    const validManifest: RenderManifestItem[] = [
      {
        contribution_id: CLIP_2,
        contributor_id: USER_B,
        media_path: `${USER_B}/segment-two.mp4`,
        media_type: "short_video",
        sequence_order: 2,
        consent_granted_at: "2026-10-12T10:05:00.000Z",
        consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      },
      {
        contribution_id: CLIP_1,
        contributor_id: USER_A,
        media_path: `${USER_A}/segment-one.mp4`,
        media_type: "short_video",
        sequence_order: 1,
        consent_granted_at: "2026-10-12T10:00:00.000Z",
        consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      },
    ];

    const check = validateAndOrderRenderManifest(validManifest);
    expect(check.valid).toBe(true);
    expect(check.orderedManifest.map((m) => m.contribution_id)).toEqual([
      CLIP_1,
      CLIP_2,
    ]);

    // Reject empty manifest
    expect(validateAndOrderRenderManifest([]).valid).toBe(false);

    // Reject cross-user forged storage path in manifest
    const forgedPathManifest: RenderManifestItem[] = [
      {
        ...validManifest[0],
        media_path: `${USER_A}/stolen-clip.mp4`, // belongs to USER_A, not USER_B
      },
    ];
    expect(validateAndOrderRenderManifest(forgedPathManifest).valid).toBe(false);

    // Reject missing consent timestamp
    const missingConsentTime: RenderManifestItem[] = [
      {
        ...validManifest[1],
        consent_granted_at: "",
      },
    ];
    expect(validateAndOrderRenderManifest(missingConsentTime).valid).toBe(false);
  });

  it("queues valid render jobs via ContractQueueStitchingAdapter without pretending synchronous FFmpeg execution", async () => {
    const adapter = new ContractQueueStitchingAdapter();
    expect(adapter.isExternalWorkerConfigured).toBe(false);

    const res = await adapter.enqueueRenderJob({
      jobId: "33333333-2222-4333-8444-555555555555",
      projectId: PROJ_ID,
      projectOwnerId: USER_A,
      idempotencyKey: "idem-001",
      timeoutSeconds: 300,
      manifest: [
        {
          contribution_id: CLIP_1,
          contributor_id: USER_A,
          media_path: `${USER_A}/segment-one.mp4`,
          media_type: "short_video",
          sequence_order: 1,
          consent_granted_at: "2026-10-12T10:00:00.000Z",
          consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
        },
      ],
    });

    expect(res.accepted).toBe(true);
    expect(res.status).toBe("queued");
    expect(res.externalWorkerConfigured).toBe(false);
  });
});
