"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  defaultStorageProvider,
  DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
} from "@/lib/storage/supabase-storage";
import {
  createProjectSchema,
  updateProjectSchema,
  inviteParticipantSchema,
  respondParticipationSchema,
  manageParticipantSchema,
  submitContributionSchema,
  withdrawConsentSchema,
  reviewContributionSchema,
  reorderContributionsSchema,
  requestRenderSchema,
  retryRenderJobSchema,
  CURRENT_CONSENT_POLICY_VERSION,
  type CreateProjectInput,
  type UpdateProjectInput,
  type InviteParticipantInput,
  type RespondParticipationInput,
  type ManageParticipantInput,
  type SubmitContributionInput,
  type WithdrawConsentInput,
  type ReviewContributionInput,
  type ReorderContributionsInput,
  type RequestRenderInput,
  type RetryRenderJobInput,
  type ProjectSummaryDTO,
  type ProjectParticipantDTO,
  type ProjectContributionDTO,
  type ProjectRenderJobDTO,
  type RenderManifestItem,
} from "@/lib/collaboration/types";
import {
  defaultStitchingProvider,
  type StitchJobSubmissionResult,
} from "@/lib/collaboration/render-provider";
import { parseCollaborativeOutputProvenance } from "@/lib/authenticity/types";
import type { ActionResult } from "./auth";
import type {
  Database,
  CollaborativeProject,
  ProjectContribution,
  ProjectParticipant,
  ProjectRenderJob,
} from "@/lib/supabase/types";

function mapSafeError(errMsg: string | undefined, fallback: string): string {
  if (!errMsg) return fallback;
  const lower = errMsg.toLowerCase();
  if (lower.includes("restricted")) {
    return "This action cannot be completed due to an active account or content restriction.";
  }
  if (lower.includes("consent")) {
    return "Explicit media usage consent is required and must remain active.";
  }
  if (lower.includes("invite") || lower.includes("private")) {
    return "This project requires an invitation or active participation.";
  }
  if (lower.includes("editor") || lower.includes("owner") || lower.includes("unauthorized")) {
    return "You do not have permission to perform this project action.";
  }
  if (lower.includes("maximum retry")) {
    return "Maximum retry attempts have been reached for this render job.";
  }
  if (lower.includes("idx_project_render_jobs_one_active")) {
    return "A render job is already queued or processing for this project.";
  }
  if (lower.includes("no approved and consented")) {
    return "At least one approved contribution with active consent is required to start rendering.";
  }
  return fallback;
}

function toRenderJobDTO(job: ProjectRenderJob): ProjectRenderJobDTO {
  const manifest = Array.isArray(job.input_manifest) ? job.input_manifest : [];
  return {
    id: job.id,
    projectId: job.project_id,
    requestedBy: job.requested_by,
    idempotencyKey: job.idempotency_key,
    status: job.status,
    clipCount: manifest.length,
    manifestSummary: manifest.map((item) => ({
      contributionId: item.contribution_id,
      contributorId: item.contributor_id,
      mediaType: item.media_type,
      sequenceOrder: item.sequence_order,
      consentPolicyVersion: item.consent_policy_version,
      aiDisclosureStatus: item.ai_disclosure_status ?? "not_declared",
    })),
    hasOutputMedia: Boolean(job.output_media_path && job.status === "completed"),
    outputProvenance:
      job.status === "completed"
        ? parseCollaborativeOutputProvenance(job.output_provenance)
        : null,
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    timeoutSeconds: job.timeout_seconds,
    failureReason: job.failure_reason,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

/**
 * Creates a new collaborative project.
 */
export async function createProjectAction(
  input: CreateProjectInput
): Promise<ActionResult<{ project: CollaborativeProject }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to create a project." };
  }

  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid project details.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { title, description, communityId, visibility, participationMode, status } =
    parsed.data;

  const { data: project, error } = await supabase
    .from("collaborative_projects")
    .insert({
      creator_id: user.id,
      community_id: communityId || null,
      title,
      description: description || null,
      visibility,
      participation_mode: visibility === "private" ? "invite_only" : participationMode,
      status,
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
    })
    .select("*")
    .single();

  if (error || !project) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to create collaborative project."),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { project: { ...project, output_media_path: null } },
    message: "Collaborative project created.",
  };
}

/**
 * Updates an existing collaborative project's settings or status.
 */
export async function updateProjectAction(
  input: UpdateProjectInput
): Promise<ActionResult<{ project: CollaborativeProject }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid project update.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { projectId, title, description, status, visibility, participationMode } =
    parsed.data;

  const payload: Database["public"]["Tables"]["collaborative_projects"]["Update"] = {};
  if (title !== undefined) payload.title = title;
  if (description !== undefined) payload.description = description;
  if (status !== undefined) payload.status = status;
  if (visibility !== undefined) payload.visibility = visibility;
  if (participationMode !== undefined) payload.participation_mode = participationMode;

  const { data: existingProj } =
    status === "cancelled"
      ? await supabase
          .from("collaborative_projects")
          .select("output_media_path")
          .eq("id", projectId)
          .maybeSingle()
      : { data: null };
  const previousOutputPath = existingProj?.output_media_path;

  const { data: project, error } = await supabase
    .from("collaborative_projects")
    .update(payload)
    .eq("id", projectId)
    .select("*")
    .maybeSingle();

  if (error || !project) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to update project."),
    };
  }

  if (previousOutputPath) {
    await defaultStorageProvider.deleteFilesBatch([previousOutputPath]);
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { project: { ...project, output_media_path: null } },
    message: "Project updated.",
  };
}

/**
 * Lists collaborative projects visible to the authenticated user.
 */
export async function getProjectsAction(options?: {
  communityId?: string;
}): Promise<ActionResult<{ projects: ProjectSummaryDTO[]; currentUserId: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  let query = supabase
    .from("collaborative_projects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (options?.communityId) {
    const validComm = z.string().uuid().safeParse(options.communityId);
    if (!validComm.success) {
      return { success: false, message: "Invalid community filter." };
    }
    query = query.eq("community_id", validComm.data);
  }

  const { data: rawProjects, error } = await query;
  if (error || !rawProjects) {
    return { success: false, message: "Unable to load collaborative projects." };
  }

  if (rawProjects.length === 0) {
    return { success: true, data: { projects: [], currentUserId: user.id } };
  }

  const projectIds = rawProjects.map((p) => p.id);
  const creatorIds = Array.from(new Set(rawProjects.map((p) => p.creator_id)));
  const communityIds = Array.from(
    new Set(rawProjects.map((p) => p.community_id).filter((id): id is string => Boolean(id)))
  );

  const [profilesRes, communitiesRes, participantsRes, contributionsRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", creatorIds),
      communityIds.length > 0
        ? supabase
            .from("communities")
            .select("id, name, slug")
            .in("id", communityIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string; slug: string }> }),
      supabase
        .from("project_participants")
        .select("project_id, user_id, role, status")
        .in("project_id", projectIds),
      supabase
        .from("project_contributions")
        .select("project_id, review_status, consent_granted, consent_withdrawn_at")
        .in("project_id", projectIds)
        .eq("review_status", "approved")
        .eq("consent_granted", true)
        .is("consent_withdrawn_at", null),
    ]);

  const profileMap = new Map(
    (profilesRes.data ?? []).map((pr) => [pr.id, pr])
  );
  const communityMap = new Map(
    (communitiesRes.data ?? []).map((c) => [c.id, c])
  );

  const activeCountMap = new Map<string, number>();
  const viewerParticipantMap = new Map<
    string,
    { role: ProjectParticipant["role"]; status: ProjectParticipant["status"] }
  >();

  for (const part of participantsRes.data ?? []) {
    if (part.status === "active") {
      activeCountMap.set(
        part.project_id,
        (activeCountMap.get(part.project_id) ?? 0) + 1
      );
    }
    if (part.user_id === user.id) {
      viewerParticipantMap.set(part.project_id, {
        role: part.role,
        status: part.status,
      });
    }
  }

  const approvedCountMap = new Map<string, number>();
  for (const contrib of contributionsRes.data ?? []) {
    approvedCountMap.set(
      contrib.project_id,
      (approvedCountMap.get(contrib.project_id) ?? 0) + 1
    );
  }

  const projects: ProjectSummaryDTO[] = rawProjects.map((p) => {
    const creator = profileMap.get(p.creator_id);
    const comm = p.community_id ? communityMap.get(p.community_id) : undefined;
    const viewerPart = viewerParticipantMap.get(p.id);
    return {
      id: p.id,
      creatorId: p.creator_id,
      creatorUsername: creator?.username ?? "member",
      creatorDisplayName: creator?.display_name || creator?.username || "Member",
      communityId: p.community_id,
      communityName: comm?.name ?? null,
      communitySlug: comm?.slug ?? null,
      title: p.title,
      description: p.description,
      status: p.status,
      visibility: p.visibility,
      participationMode: p.participation_mode,
      consentPolicyVersion: p.consent_policy_version,
      hasOutputMedia: Boolean(p.output_media_path && p.status === "completed"),
      outputProvenance:
        p.status === "completed"
          ? parseCollaborativeOutputProvenance(p.output_provenance)
          : null,
      viewerRole: viewerPart?.role ?? null,
      viewerStatus: viewerPart?.status ?? null,
      participantCount: activeCountMap.get(p.id) ?? 1,
      approvedClipCount: approvedCountMap.get(p.id) ?? 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });

  return {
    success: true,
    data: { projects, currentUserId: user.id },
  };
}

/**
 * Fetches full details for a single collaborative project (participants, contributions, render jobs).
 * Masks raw storage paths across all DTOs.
 */
export async function getProjectDetailsAction(projectId: string): Promise<
  ActionResult<{
    project: ProjectSummaryDTO;
    participants: ProjectParticipantDTO[];
    contributions: ProjectContributionDTO[];
    renderJobs: ProjectRenderJobDTO[];
    currentUserId: string;
  }>
> {
  const validId = z.string().uuid("Invalid project ID").safeParse(projectId);
  if (!validId.success) {
    return { success: false, message: "Invalid project ID." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: p, error: projErr } = await supabase
    .from("collaborative_projects")
    .select("*")
    .eq("id", validId.data)
    .maybeSingle();

  if (projErr || !p) {
    return { success: false, message: "Project not found or unavailable." };
  }

  const [participantsRes, contributionsRes, jobsRes, commRes] = await Promise.all([
    supabase
      .from("project_participants")
      .select("*")
      .eq("project_id", p.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("project_contributions")
      .select("*")
      .eq("project_id", p.id)
      .order("sequence_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_render_jobs")
      .select("*")
      .eq("project_id", p.id)
      .order("created_at", { ascending: false })
      .limit(10),
    p.community_id
      ? supabase
          .from("communities")
          .select("id, name, slug")
          .eq("id", p.community_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rawParticipants = participantsRes.data ?? [];
  const rawContributions = contributionsRes.data ?? [];
  const rawJobs = jobsRes.data ?? [];

  const profileIds = Array.from(
    new Set([
      p.creator_id,
      ...rawParticipants.map((pt) => pt.user_id),
      ...rawContributions.map((c) => c.contributor_id),
    ])
  );

  const { data: profilesData } =
    profileIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, username, display_name")
          .in("id", profileIds)
      : { data: [] as Array<{ id: string; username: string; display_name: string | null }> };

  const profileMap = new Map((profilesData ?? []).map((pr) => [pr.id, pr]));

  const participants: ProjectParticipantDTO[] = rawParticipants.map((pt) => {
    const prof = profileMap.get(pt.user_id);
    return {
      id: pt.id,
      projectId: pt.project_id,
      userId: pt.user_id,
      username: prof?.username ?? "member",
      displayName: prof?.display_name || prof?.username || "Member",
      role: pt.role,
      status: pt.status,
      invitedBy: pt.invited_by,
      createdAt: pt.created_at,
    };
  });

  const contributions: ProjectContributionDTO[] = rawContributions.map((c) => {
    const prof = profileMap.get(c.contributor_id);
    return {
      id: c.id,
      projectId: c.project_id,
      contributorId: c.contributor_id,
      contributorUsername: prof?.username ?? "contributor",
      contributorDisplayName: prof?.display_name || prof?.username || "Contributor",
      sourcePostId: c.source_post_id,
      hasMedia: Boolean(
        c.media_path && c.consent_granted && !c.consent_withdrawn_at
      ),
      mediaType: c.media_type,
      mediaMetadata: c.media_metadata,
      caption: c.caption,
      aiDisclosureStatus: c.ai_disclosure_status ?? "not_declared",
      aiDisclosureDetails: c.ai_disclosure_details ?? null,
      aiDisclosedAt: c.ai_disclosed_at ?? null,
      provenanceStatus: c.provenance_status ?? "unverified",
      consentGranted: c.consent_granted,
      consentGrantedAt: c.consent_granted_at,
      consentPolicyVersion: c.consent_policy_version,
      consentWithdrawnAt: c.consent_withdrawn_at,
      withdrawalReason: c.withdrawal_reason,
      reviewStatus: c.review_status,
      reviewedAt: c.reviewed_at,
      reviewNote: c.review_note,
      sequenceOrder: c.sequence_order,
      createdAt: c.created_at,
    };
  });

  const renderJobs: ProjectRenderJobDTO[] = rawJobs.map(toRenderJobDTO);

  const viewerPart = rawParticipants.find((pt) => pt.user_id === user.id);
  const creatorProf = profileMap.get(p.creator_id);
  const activeParticipantCount = rawParticipants.filter(
    (pt) => pt.status === "active"
  ).length;
  const approvedClipCount = rawContributions.filter(
    (c) =>
      c.review_status === "approved" &&
      c.consent_granted &&
      !c.consent_withdrawn_at
  ).length;

  const projectSummary: ProjectSummaryDTO = {
    id: p.id,
    creatorId: p.creator_id,
    creatorUsername: creatorProf?.username ?? "member",
    creatorDisplayName:
      creatorProf?.display_name || creatorProf?.username || "Member",
    communityId: p.community_id,
    communityName: commRes.data?.name ?? null,
    communitySlug: commRes.data?.slug ?? null,
    title: p.title,
    description: p.description,
    status: p.status,
    visibility: p.visibility,
    participationMode: p.participation_mode,
    consentPolicyVersion: p.consent_policy_version,
    hasOutputMedia: Boolean(p.output_media_path && p.status === "completed"),
    outputProvenance:
      p.status === "completed"
        ? parseCollaborativeOutputProvenance(p.output_provenance)
        : null,
    viewerRole: viewerPart?.role ?? null,
    viewerStatus: viewerPart?.status ?? null,
    participantCount: activeParticipantCount,
    approvedClipCount,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };

  return {
    success: true,
    data: {
      project: projectSummary,
      participants,
      contributions,
      renderJobs,
      currentUserId: user.id,
    },
  };
}

/**
 * Joins an open public project or requests to join an invite-only public project.
 */
export async function joinOrRequestProjectAction(
  projectId: string
): Promise<ActionResult<{ participant: ProjectParticipant }>> {
  const validId = z.string().uuid("Invalid project ID").safeParse(projectId);
  if (!validId.success) {
    return { success: false, message: "Invalid project ID." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: proj } = await supabase
    .from("collaborative_projects")
    .select("id, visibility, participation_mode, status")
    .eq("id", validId.data)
    .maybeSingle();

  if (!proj || proj.visibility !== "public" || proj.status !== "open") {
    return {
      success: false,
      message: "Project is not open for self-enrollment.",
    };
  }

  const desiredStatus =
    proj.participation_mode === "open" ? "active" : "requested";

  const { data: participant, error } = await supabase
    .from("project_participants")
    .insert({
      project_id: proj.id,
      user_id: user.id,
      role: "contributor",
      status: desiredStatus,
    })
    .select("*")
    .single();

  if (error || !participant) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to join project."),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { participant },
    message:
      desiredStatus === "active"
        ? "Joined project as a contributor."
        : "Participation request submitted for editor review.",
  };
}

/**
 * Invites a user to a collaborative project by username or userId.
 */
export async function inviteParticipantByUsernameAction(input: {
  projectId: string;
  username: string;
  role?: "editor" | "contributor";
}): Promise<ActionResult<{ participant: ProjectParticipant }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const cleanUsername = input.username.trim().replace(/^@/, "").toLowerCase();
  if (!cleanUsername || cleanUsername.length < 2) {
    return { success: false, message: "Enter a valid username to invite." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("id, username")
    .ilike("username", cleanUsername)
    .maybeSingle();

  if (!targetProfile) {
    return { success: false, message: "User profile not found." };
  }

  return inviteParticipantAction({
    projectId: input.projectId,
    targetUserId: targetProfile.id,
    role: input.role ?? "contributor",
  });
}

export async function inviteParticipantAction(
  input: InviteParticipantInput
): Promise<ActionResult<{ participant: ProjectParticipant }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = inviteParticipantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid invitation input.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { projectId, targetUserId, role } = parsed.data;

  const { data: participant, error } = await supabase
    .from("project_participants")
    .insert({
      project_id: projectId,
      user_id: targetUserId,
      role,
      status: "invited",
      invited_by: user.id,
    })
    .select("*")
    .single();

  if (error || !participant) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to invite user to project."),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { participant },
    message: "Invitation sent.",
  };
}

/**
 * Allows an invited user to accept or decline a project invitation, or an active contributor to leave.
 */
export async function respondParticipationAction(
  input: RespondParticipationInput
): Promise<ActionResult<{ participant: ProjectParticipant }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = respondParticipationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid participation response." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const newStatus = parsed.data.decision === "accept" ? "active" : "declined";

  const { data: participant, error } = await supabase
    .from("project_participants")
    .update({ status: newStatus })
    .eq("project_id", parsed.data.projectId)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error || !participant) {
    return {
      success: false,
      message: mapSafeError(
        error?.message,
        "Unable to update participation status."
      ),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { participant },
    message:
      newStatus === "active"
        ? "Invitation accepted. You can now contribute clips."
        : "Participation declined.",
  };
}

/**
 * Allows project editors/owners to approve/reject requests, promote/demote editors, or remove participants.
 */
export async function manageParticipantAction(
  input: ManageParticipantInput
): Promise<ActionResult<{ participant: ProjectParticipant }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = manageParticipantSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid participant management action." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { projectId, participantUserId, action } = parsed.data;
  const updatePayload: Database["public"]["Tables"]["project_participants"]["Update"] = {};

  if (action === "approve_request") {
    updatePayload.status = "active";
  } else if (action === "reject_request") {
    updatePayload.status = "declined";
  } else if (action === "promote_editor") {
    updatePayload.role = "editor";
  } else if (action === "demote_contributor") {
    updatePayload.role = "contributor";
  } else if (action === "remove") {
    updatePayload.status = "removed";
  }

  const { data: participant, error } = await supabase
    .from("project_participants")
    .update(updatePayload)
    .eq("project_id", projectId)
    .eq("user_id", participantUserId)
    .select("*")
    .maybeSingle();

  if (error || !participant) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to update participant."),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { participant },
    message: "Participant updated.",
  };
}

/**
 * Submits a video contribution with explicit recorded usage consent.
 */
export async function submitContributionAction(
  input: SubmitContributionInput
): Promise<ActionResult<{ contribution: ProjectContributionDTO }>> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      message: "Authentication required to submit a contribution.",
    };
  }

  const parsed = submitContributionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message:
        parsed.error.issues[0]?.message || "Invalid contribution submission.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const {
    projectId,
    sourcePostId,
    mediaPath,
    mediaType,
    mediaMetadata,
    caption,
    aiDisclosureStatus,
    aiDisclosureDetails,
    consentGranted,
    consentPolicyVersion,
  } = parsed.data;

  // Enforce storage path ownership before hitting DB
  if (!defaultStorageProvider.validatePathOwnership(user.id, mediaPath)) {
    return {
      success: false,
      message:
        "Security violation: Media path does not belong to the authenticated contributor.",
    };
  }

  const ext = mediaPath.split(".").pop()?.toLowerCase();
  const fileCheck = defaultStorageProvider.validateFileConstraints(
    mediaType,
    mediaMetadata.mimeType,
    mediaMetadata.sizeBytes,
    ext
  );
  if (!fileCheck.valid) {
    return {
      success: false,
      message: fileCheck.error || "Invalid media file constraints.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: inserted, error } = await supabase
    .from("project_contributions")
    .insert({
      project_id: projectId,
      contributor_id: user.id,
      source_post_id: sourcePostId || null,
      media_path: mediaPath,
      media_type: mediaType,
      media_metadata: mediaMetadata,
      caption: caption || null,
      ai_disclosure_status: aiDisclosureStatus,
      ai_disclosure_details:
        aiDisclosureStatus === "not_declared"
          ? null
          : aiDisclosureDetails || null,
      consent_granted: consentGranted,
      consent_policy_version: consentPolicyVersion,
    })
    .select("*")
    .single();

  if (error || !inserted) {
    return {
      success: false,
      message: mapSafeError(
        error?.message,
        "Unable to submit contribution to project."
      ),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: {
      contribution: {
        id: inserted.id,
        projectId: inserted.project_id,
        contributorId: inserted.contributor_id,
        contributorUsername: "you",
        contributorDisplayName: "You",
        sourcePostId: inserted.source_post_id,
        hasMedia: true,
        mediaType: inserted.media_type,
        mediaMetadata: inserted.media_metadata,
        caption: inserted.caption,
        aiDisclosureStatus: inserted.ai_disclosure_status ?? "not_declared",
        aiDisclosureDetails: inserted.ai_disclosure_details ?? null,
        aiDisclosedAt: inserted.ai_disclosed_at ?? null,
        provenanceStatus: inserted.provenance_status ?? "unverified",
        consentGranted: inserted.consent_granted,
        consentGrantedAt: inserted.consent_granted_at,
        consentPolicyVersion: inserted.consent_policy_version,
        consentWithdrawnAt: inserted.consent_withdrawn_at,
        withdrawalReason: inserted.withdrawal_reason,
        reviewStatus: inserted.review_status,
        reviewedAt: inserted.reviewed_at,
        reviewNote: inserted.review_note,
        sequenceOrder: inserted.sequence_order,
        createdAt: inserted.created_at,
      },
    },
    message: "Contribution submitted with recorded usage consent.",
  };
}

/**
 * Withdraws a contributor's consent for a submitted clip.
 * Automatically excludes the clip, aborts active render jobs, and invalidates completed output if applicable.
 */
export async function withdrawContributionConsentAction(
  input: WithdrawConsentInput
): Promise<ActionResult<{ contributionId: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = withdrawConsentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid withdrawal request.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Check if target project currently has a rendered output that will be invalidated
  const { data: existingContrib } = await supabase
    .from("project_contributions")
    .select("project_id, review_status, project:collaborative_projects(output_media_path)")
    .eq("id", parsed.data.contributionId)
    .eq("contributor_id", user.id)
    .maybeSingle();

  const previousOutputPath = (
    existingContrib?.project as { output_media_path?: string | null } | null
  )?.output_media_path;

  const { data: updated, error } = await supabase
    .from("project_contributions")
    .update({
      consent_granted: false,
      review_status: "withdrawn",
      withdrawal_reason: parsed.data.reason || "Consent withdrawn by contributor",
    })
    .eq("id", parsed.data.contributionId)
    .eq("contributor_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return {
      success: false,
      message: mapSafeError(
        error?.message,
        "Unable to withdraw contribution consent."
      ),
    };
  }

  // Delete invalidated collaborative project output binary from Storage
  if (previousOutputPath) {
    await defaultStorageProvider.deleteFilesBatch([previousOutputPath]);
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { contributionId: updated.id },
    message:
      "Consent withdrawn. Your clip has been excluded from future and active project renders.",
  };
}

/**
 * Reviews (approves or rejects) a project contribution. Restricted to project editors/owners.
 */
export async function reviewContributionAction(
  input: ReviewContributionInput
): Promise<ActionResult<{ contributionId: string; reviewStatus: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = reviewContributionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid review decision.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const updateData: ProjectContribution["review_status"] = parsed.data.decision;
  const payload: Database["public"]["Tables"]["project_contributions"]["Update"] = {
    review_status: updateData,
    review_note: parsed.data.reviewNote || null,
  };
  if (parsed.data.sequenceOrder !== undefined && updateData === "approved") {
    payload.sequence_order = parsed.data.sequenceOrder;
  }

  const { data: updated, error } = await supabase
    .from("project_contributions")
    .update(payload)
    .eq("id", parsed.data.contributionId)
    .select("id, review_status")
    .maybeSingle();

  if (error || !updated) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to review contribution."),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: {
      contributionId: updated.id,
      reviewStatus: updated.review_status,
    },
    message:
      updated.review_status === "approved"
        ? "Contribution approved and added to sequence."
        : "Contribution rejected.",
  };
}

/**
 * Reorders approved contributions in a project. Restricted to project editors/owners.
 */
export async function reorderContributionsAction(
  input: ReorderContributionsInput
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = reorderContributionsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid clip order.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { projectId, orderedContributionIds } = parsed.data;

  // Verify all target contributions belong to projectId and are approved with active consent
  const { data: existingApproved, error: fetchErr } = await supabase
    .from("project_contributions")
    .select("id")
    .eq("project_id", projectId)
    .eq("review_status", "approved")
    .eq("consent_granted", true)
    .is("consent_withdrawn_at", null);

  if (fetchErr || !existingApproved) {
    return { success: false, message: "Unable to verify approved clips." };
  }

  const approvedSet = new Set(existingApproved.map((c) => c.id));
  for (const id of orderedContributionIds) {
    if (!approvedSet.has(id)) {
      return {
        success: false,
        message:
          "Only approved contributions with active consent can be ordered.",
      };
    }
  }

  for (let i = 0; i < orderedContributionIds.length; i++) {
    const clipId = orderedContributionIds[i];
    const { error: updErr } = await supabase
      .from("project_contributions")
      .update({ sequence_order: i + 1 })
      .eq("id", clipId)
      .eq("project_id", projectId);

    if (updErr) {
      return {
        success: false,
        message: mapSafeError(updErr.message, "Unable to reorder clips."),
      };
    }
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    message: "Clip sequence order updated.",
  };
}

/**
 * Requests a durable video stitching render job for a project.
 * Enforces idempotency on (project_id, idempotency_key) and validates the ordered
 * manifest through the provider-neutral VideoStitchingProvider without running
 * FFmpeg inside the Next.js server action.
 */
export async function requestProjectRenderAction(
  input: RequestRenderInput
): Promise<
  ActionResult<{
    job: ProjectRenderJobDTO;
    providerResult: StitchJobSubmissionResult;
    idempotentReplay: boolean;
  }>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = requestRenderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid render request.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { projectId, idempotencyKey } = parsed.data;

  // 1. Check idempotent replay first
  const { data: existingJob } = await supabase
    .from("project_render_jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingJob) {
    const providerResult = await defaultStitchingProvider.enqueueRenderJob({
      jobId: existingJob.id,
      projectId: existingJob.project_id,
      projectOwnerId: user.id,
      idempotencyKey: existingJob.idempotency_key,
      manifest: existingJob.input_manifest as RenderManifestItem[],
      timeoutSeconds: existingJob.timeout_seconds,
    });
    return {
      success: true,
      data: {
        job: toRenderJobDTO(existingJob),
        providerResult,
        idempotentReplay: true,
      },
      message: "Existing render job returned for idempotency key.",
    };
  }

  // 2. Insert new durable render job (DB trigger validates editor role, builds authoritative manifest, and locks project to 'rendering')
  const { data: createdJob, error } = await supabase
    .from("project_render_jobs")
    .insert({
      project_id: projectId,
      requested_by: user.id,
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();

  if (error || !createdJob) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to initiate render job."),
    };
  }

  // 3. Hand off to provider-neutral stitching interface
  const providerResult = await defaultStitchingProvider.enqueueRenderJob({
    jobId: createdJob.id,
    projectId: createdJob.project_id,
    projectOwnerId: user.id,
    idempotencyKey: createdJob.idempotency_key,
    manifest: createdJob.input_manifest as RenderManifestItem[],
    timeoutSeconds: createdJob.timeout_seconds,
  });

  revalidatePath("/collaborate");
  return {
    success: true,
    data: {
      job: toRenderJobDTO(createdJob),
      providerResult,
      idempotentReplay: false,
    },
    message: providerResult.diagnostics,
  };
}

/**
 * Retries a failed render job within bounded max_attempts.
 */
export async function retryProjectRenderJobAction(
  input: RetryRenderJobInput
): Promise<ActionResult<{ job: ProjectRenderJobDTO }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const parsed = retryRenderJobSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid render job ID." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: updatedJob, error } = await supabase
    .from("project_render_jobs")
    .update({ status: "queued" })
    .eq("id", parsed.data.jobId)
    .select("*")
    .maybeSingle();

  if (error || !updatedJob) {
    return {
      success: false,
      message: mapSafeError(error?.message, "Unable to retry render job."),
    };
  }

  revalidatePath("/collaborate");
  return {
    success: true,
    data: { job: toRenderJobDTO(updatedJob) },
    message: `Render job re-queued (attempt ${updatedJob.attempt_count} of ${updatedJob.max_attempts}).`,
  };
}

/**
 * Generates a short-lived (300s) signed download URL for a consented contribution clip.
 * Never exposes the raw storage path if unauthorized or if consent was withdrawn.
 */
export async function getContributionMediaUrlAction(
  contributionId: string
): Promise<ActionResult<{ signedUrl: string; expiresInSeconds: number }>> {
  const validId = z.string().uuid("Invalid contribution ID").safeParse(contributionId);
  if (!validId.success) {
    return { success: false, message: "Invalid contribution ID." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: contrib, error } = await supabase
    .from("project_contributions")
    .select(
      "id, contributor_id, media_path, consent_granted, consent_withdrawn_at, review_status"
    )
    .eq("id", validId.data)
    .maybeSingle();

  if (
    error ||
    !contrib ||
    !contrib.media_path ||
    !contrib.consent_granted ||
    contrib.consent_withdrawn_at !== null ||
    contrib.review_status === "withdrawn"
  ) {
    return {
      success: false,
      message: "Contribution media is unavailable or consent was withdrawn.",
    };
  }

  if (
    !defaultStorageProvider.validatePathOwnership(
      contrib.contributor_id,
      contrib.media_path
    )
  ) {
    return { success: false, message: "Invalid media path ownership." };
  }

  const expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
  const signedUrl = await defaultStorageProvider.getSignedUrl(
    contrib.media_path,
    expiresInSeconds
  );

  if (!signedUrl) {
    return { success: false, message: "Unable to authorize clip playback." };
  }

  return {
    success: true,
    data: { signedUrl, expiresInSeconds },
  };
}

/**
 * Generates a short-lived (300s) signed download URL for a completed collaborative project output video.
 * Denies access for draft, open, rendering, or cancelled projects.
 */
export async function getProjectOutputMediaUrlAction(
  projectId: string
): Promise<ActionResult<{ signedUrl: string; expiresInSeconds: number }>> {
  const validId = z.string().uuid("Invalid project ID").safeParse(projectId);
  if (!validId.success) {
    return { success: false, message: "Invalid project ID." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: proj, error } = await supabase
    .from("collaborative_projects")
    .select("id, status, output_media_path")
    .eq("id", validId.data)
    .maybeSingle();

  if (error || !proj || proj.status !== "completed" || !proj.output_media_path) {
    return {
      success: false,
      message: "Project output media is not available.",
    };
  }

  const expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
  const signedUrl = await defaultStorageProvider.getSignedUrl(
    proj.output_media_path,
    expiresInSeconds
  );

  if (!signedUrl) {
    return { success: false, message: "Unable to authorize output playback." };
  }

  return {
    success: true,
    data: { signedUrl, expiresInSeconds },
  };
}

/**
 * Lists the current user's own published video posts so they can optionally submit existing eligible clips.
 */
export async function getEligibleVideoPostsForContributionAction(): Promise<
  ActionResult<{
    posts: Array<{
      id: string;
      caption: string | null;
      contentType: "short_video" | "long_video";
      mediaPath: string;
      mediaMetadata: {
        mimeType: string;
        sizeBytes: number;
        width?: number;
        height?: number;
        durationSeconds?: number;
      };
      createdAt: string;
    }>;
  }>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: rows, error } = await supabase
    .from("posts")
    .select("id, caption, content_type, media_path, media_metadata, created_at")
    .eq("creator_id", user.id)
    .eq("status", "published")
    .in("content_type", ["short_video", "long_video"])
    .not("media_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error || !rows) {
    return { success: false, message: "Unable to load eligible video posts." };
  }

  const posts = rows
    .filter(
      (r) =>
        Boolean(r.media_path) &&
        (r.content_type === "short_video" || r.content_type === "long_video") &&
        Boolean(r.media_metadata)
    )
    .map((r) => ({
      id: r.id,
      caption: r.caption,
      contentType: r.content_type as "short_video" | "long_video",
      mediaPath: r.media_path as string,
      mediaMetadata: r.media_metadata as {
        mimeType: string;
        sizeBytes: number;
        width?: number;
        height?: number;
        durationSeconds?: number;
      },
      createdAt: r.created_at,
    }));

  return { success: true, data: { posts } };
}
