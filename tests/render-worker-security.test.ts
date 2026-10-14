import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildCanonicalRenderOutputPath,
  generateSyntheticVideoClip,
  isAuthorizedContributionMediaPath,
  isCanonicalRenderOutputPath,
  probeVideoFrameRgb,
  processProjectRenderJob,
  resolveWorkerRuntimeConfig,
} from "@/lib/collaboration/ffmpeg-worker";
import { CURRENT_CONSENT_POLICY_VERSION, type RenderManifestItem } from "@/lib/collaboration/types";
import type { Database, ProjectRenderJob } from "@/lib/supabase/types";

function matchesFilters<T extends object>(
  row: T,
  eqFilters: Array<[string, unknown]>,
  inFilters: Array<[string, unknown[]]>
): boolean {
  return (
    eqFilters.every(([k, v]) => Reflect.get(row, k) === v) &&
    inFilters.every(([k, vals]) => vals.includes(Reflect.get(row, k)))
  );
}

const USER_A_ID = "11111111-1111-4111-8111-111111111111"; // Dedicated Render Worker (non-participant)
const USER_B_ID = "22222222-2222-4222-8222-222222222222"; // Project B Owner
const USER_C_ID = "33333333-3333-4333-8333-333333333333"; // Project B Contributor & Project C Owner
const USER_D_ID = "44444444-4444-4444-8444-444444444444"; // Unrelated Ordinary User
const WORKER_2_ID = "55555555-5555-4555-8555-555555555555"; // Second Dedicated Render Worker

const PROJECT_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_C_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTRIB_B1_ID = "b1111111-1111-4111-8111-111111111111";
const CONTRIB_B2_ID = "b2222222-2222-4222-8222-222222222222";
const CONTRIB_C1_ID = "c1111111-1111-4111-8111-111111111111";
const JOB_B_ID = "d1111111-1111-4111-8111-111111111111";
const JOB_C_ID = "d2222222-2222-4222-8222-222222222222";
const PRIVATE_POST_C_ID = "e1111111-1111-4111-8111-111111111111";

interface SimulatedProfile {
  id: string;
  account_status: "active" | "deactivated";
  is_private: boolean;
  is_restricted?: boolean;
}

interface SimulatedRenderWorker {
  user_id: string;
  worker_name: string;
  is_active: boolean;
  allow_user_uploads: boolean;
}

interface SimulatedProject {
  id: string;
  creator_id: string;
  community_id: string | null;
  title: string;
  status: "draft" | "open" | "locked" | "rendering" | "completed" | "cancelled";
  visibility: "public" | "private";
  participation_mode: "open" | "invite_only";
  consent_policy_version: string;
  output_media_path: string | null;
  output_provenance: unknown;
}

interface SimulatedParticipant {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "contributor";
  status: "invited" | "requested" | "active" | "declined" | "removed";
}

interface SimulatedContribution {
  id: string;
  project_id: string;
  contributor_id: string;
  media_path: string;
  media_type: "short_video" | "long_video";
  review_status: "pending" | "approved" | "rejected" | "withdrawn";
  consent_granted: boolean;
  consent_granted_at: string | null;
  consent_withdrawn_at: string | null;
  consent_policy_version: string;
  sequence_order: number | null;
  ai_disclosure_status:
    | "not_declared"
    | "no_ai_declared"
    | "ai_generated"
    | "ai_assisted"
    | "material_alteration";
}

interface SimulatedPost {
  id: string;
  creator_id: string;
  status?: "draft" | "published" | "removed";
  visibility: "public" | "followers" | "private";
  media_url: string | null;
  is_restricted?: boolean;
}

interface SimulatedFollow {
  follower_id: string;
  following_id: string;
  status: "pending" | "accepted";
}

interface SimulatedBlock {
  blocker_id: string;
  blocked_id: string;
}

interface SimulatedDatabaseState {
  profiles: Map<string, SimulatedProfile>;
  renderWorkers: Map<string, SimulatedRenderWorker>;
  projects: Map<string, SimulatedProject>;
  participants: SimulatedParticipant[];
  contributions: Map<string, SimulatedContribution>;
  renderJobs: Map<string, ProjectRenderJob>;
  posts: Map<string, SimulatedPost>;
  follows: SimulatedFollow[];
  blocks: SimulatedBlock[];
  storageObjects: Map<string, Buffer>;
  activeClaimLocks: Set<string>;
}

/**
 * In-memory enforcement engine that mirrors the PostgreSQL RLS policies,
 * security-definer helpers, and BEFORE/AFTER UPDATE triggers from
 * `20261013060000_secure_render_worker_authorization.sql`.
 */
class MultiUserSupabaseSimulator {
  public readonly state: SimulatedDatabaseState;
  private readonly signedUrlBase: string;

  constructor(signedUrlBase: string) {
    this.signedUrlBase = signedUrlBase;
    this.state = {
      profiles: new Map(),
      renderWorkers: new Map(),
      projects: new Map(),
      participants: [],
      contributions: new Map(),
      renderJobs: new Map(),
      posts: new Map(),
      follows: [],
      blocks: [],
      storageObjects: new Map(),
      activeClaimLocks: new Set(),
    };
  }

  public isBlocked(userA: string, userB: string): boolean {
    return this.state.blocks.some(
      (b) =>
        (b.blocker_id === userA && b.blocked_id === userB) ||
        (b.blocker_id === userB && b.blocked_id === userA)
    );
  }

  public isAcceptedFollower(followerId: string, followingId: string): boolean {
    return this.state.follows.some(
      (f) =>
        f.follower_id === followerId &&
        f.following_id === followingId &&
        f.status === "accepted"
    );
  }

  public isAccountActive(userId: string): boolean {
    const profile = this.state.profiles.get(userId);
    return Boolean(profile && profile.account_status === "active");
  }

  public isAccountRestricted(userId: string): boolean {
    const profile = this.state.profiles.get(userId);
    return Boolean(profile?.is_restricted);
  }

  public isAuthorizedRenderWorker(userId: string, callerId: string = userId): boolean {
    if (!userId || !callerId || userId !== callerId) return false;
    const rw = this.state.renderWorkers.get(userId);
    if (!rw || !rw.is_active) return false;
    return this.isAccountActive(userId) && !this.isAccountRestricted(userId);
  }

  public isDedicatedRenderWorkerOnly(userId: string, callerId: string = userId): boolean {
    if (!userId || !callerId || userId !== callerId) return false;
    const rw = this.state.renderWorkers.get(userId);
    return Boolean(rw && rw.allow_user_uploads === false);
  }

  /**
   * Internal-only participant helper mirroring `public.is_active_project_participant_internal(p_id, u_id)`.
   * Revoked from PUBLIC/anon/authenticated; called only by trusted SECURITY DEFINER functions.
   */
  public isActiveProjectParticipantInternal(
    projectId: string,
    userId: string
  ): boolean {
    if (!projectId || !userId) return false;
    if (!this.isAccountActive(userId)) return false;
    const project = this.state.projects.get(projectId);
    if (!project) return false;
    if (this.isBlocked(project.creator_id, userId)) return false;
    if (project.creator_id === userId) return true;
    return this.state.participants.some(
      (p) =>
        p.project_id === projectId &&
        p.user_id === userId &&
        p.status === "active"
    );
  }

  /**
   * Client/RLS-callable participant helper mirroring `public.is_project_active_participant(p_id, u_id)`.
   * Enforces session `auth.uid()` (`callerId`) restrictions before delegating to `isActiveProjectParticipantInternal`.
   */
  public isProjectActiveParticipant(
    projectId: string,
    userId: string,
    callerId: string = userId
  ): boolean {
    if (!projectId || !userId || !callerId) return false;
    if (this.isDedicatedRenderWorkerOnly(callerId, callerId)) return false;
    if (userId !== callerId && !this.isProjectEditor(projectId, callerId, callerId)) {
      return false;
    }
    return this.isActiveProjectParticipantInternal(projectId, userId);
  }

  public isProjectEditor(
    projectId: string,
    userId: string,
    callerId: string = userId
  ): boolean {
    if (!projectId || !userId || !callerId || userId !== callerId) return false;
    if (this.isDedicatedRenderWorkerOnly(userId, callerId)) return false;
    if (!this.isAccountActive(userId) || this.isAccountRestricted(userId)) return false;
    const project = this.state.projects.get(projectId);
    if (!project) return false;
    if (this.isBlocked(project.creator_id, userId)) return false;
    if (project.creator_id === userId) return true;
    return this.state.participants.some(
      (p) =>
        p.project_id === projectId &&
        p.user_id === userId &&
        p.status === "active" &&
        (p.role === "owner" || p.role === "editor")
    );
  }

  public canViewProject(
    projectId: string,
    userId: string,
    callerId: string = userId
  ): boolean {
    if (!projectId) return false;
    // Mirror `u_id IS DISTINCT FROM (SELECT auth.uid())` where empty string represents SQL NULL (`anon`)
    if ((userId || "") !== (callerId || "")) return false;
    if (callerId && this.isDedicatedRenderWorkerOnly(callerId, callerId)) return false;
    if (
      callerId &&
      (!this.isAccountActive(callerId) || this.isAccountRestricted(callerId))
    ) {
      return false;
    }
    const project = this.state.projects.get(projectId);
    if (!project) return false;
    if (
      !this.isAccountActive(project.creator_id) ||
      this.isAccountRestricted(project.creator_id)
    ) {
      return false;
    }
    if (callerId && this.isBlocked(project.creator_id, callerId)) return false;
    if (callerId && project.creator_id === callerId) return true;
    if (
      callerId &&
      this.state.participants.some(
        (p) =>
          p.project_id === projectId &&
          p.user_id === callerId &&
          (p.status === "active" || p.status === "invited")
      )
    ) {
      return true;
    }
    if (project.visibility === "private" || project.status === "draft") {
      return false;
    }
    return project.visibility === "public";
  }

  public isWorkerProcessingProject(
    projectId: string,
    workerId: string,
    callerId: string = workerId
  ): boolean {
    if (!projectId || !workerId || !callerId || workerId !== callerId) return false;
    if (!this.isAuthorizedRenderWorker(workerId, callerId)) return false;
    for (const job of this.state.renderJobs.values()) {
      if (
        job.project_id === projectId &&
        job.claimed_by === callerId &&
        job.status === "processing"
      ) {
        const project = this.state.projects.get(job.project_id);
        if (!project || project.status !== "rendering") continue;
        if (
          !this.isAccountActive(project.creator_id) ||
          this.isAccountRestricted(project.creator_id)
        ) {
          continue;
        }
        try {
          this.validateManifestIntegrity(
            job.project_id,
            (job.input_manifest ?? []) as RenderManifestItem[]
          );
          return true;
        } catch {
          continue;
        }
      }
    }
    return false;
  }

  public isContributionInActiveWorkerManifest(
    projectId: string,
    contributionId: string,
    workerId: string,
    callerId: string = workerId
  ): boolean {
    if (
      !projectId ||
      !contributionId ||
      !workerId ||
      !callerId ||
      workerId !== callerId
    ) {
      return false;
    }
    if (!this.isAuthorizedRenderWorker(workerId, callerId)) return false;
    for (const job of this.state.renderJobs.values()) {
      if (
        job.project_id === projectId &&
        job.claimed_by === callerId &&
        job.status === "processing"
      ) {
        const project = this.state.projects.get(job.project_id);
        if (!project || project.status !== "rendering") continue;
        if (
          !this.isAccountActive(project.creator_id) ||
          this.isAccountRestricted(project.creator_id)
        ) {
          continue;
        }
        const manifest = (job.input_manifest ?? []) as RenderManifestItem[];
        try {
          this.validateManifestIntegrity(job.project_id, manifest);
        } catch {
          continue;
        }
        if (manifest.some((m) => m.contribution_id === contributionId)) {
          return true;
        }
      }
    }
    return false;
  }

  public isMediaInActiveWorkerManifest(
    mediaPath: string,
    workerId: string,
    callerId: string = workerId
  ): boolean {
    if (!mediaPath || !workerId || !callerId || workerId !== callerId) return false;
    if (!this.isAuthorizedRenderWorker(workerId, callerId)) return false;
    for (const job of this.state.renderJobs.values()) {
      if (job.claimed_by !== callerId || job.status !== "processing") continue;
      const project = this.state.projects.get(job.project_id);
      if (!project || project.status !== "rendering") continue;
      if (
        !this.isAccountActive(project.creator_id) ||
        this.isAccountRestricted(project.creator_id)
      ) {
        continue;
      }

      const manifest = (job.input_manifest ?? []) as RenderManifestItem[];
      try {
        this.validateManifestIntegrity(job.project_id, manifest);
      } catch {
        continue;
      }

      for (const item of manifest) {
        if (item.media_path !== mediaPath) continue;
        const pc = this.state.contributions.get(item.contribution_id);
        if (!pc || pc.project_id !== job.project_id) continue;
        if (
          pc.contributor_id === item.contributor_id &&
          pc.media_path === mediaPath &&
          isAuthorizedContributionMediaPath(pc.media_path, pc.contributor_id) &&
          pc.review_status === "approved" &&
          pc.consent_granted === true &&
          pc.consent_withdrawn_at === null &&
          pc.consent_policy_version === project.consent_policy_version &&
          this.isActiveProjectParticipantInternal(job.project_id, pc.contributor_id) &&
          !this.isBlocked(project.creator_id, pc.contributor_id) &&
          this.isAccountActive(pc.contributor_id) &&
          !this.isAccountRestricted(pc.contributor_id)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  public canUploadRenderOutputObject(
    objectName: string,
    workerId: string,
    callerId: string = workerId
  ): boolean {
    if (!objectName || !workerId || !callerId || workerId !== callerId) return false;
    if (!this.isAuthorizedRenderWorker(workerId, callerId)) return false;
    for (const job of this.state.renderJobs.values()) {
      if (job.claimed_by !== callerId || job.status !== "processing") continue;
      const project = this.state.projects.get(job.project_id);
      if (!project || project.status !== "rendering") continue;
      if (
        !this.isAccountActive(project.creator_id) ||
        this.isAccountRestricted(project.creator_id)
      ) {
        continue;
      }
      try {
        this.validateManifestIntegrity(
          job.project_id,
          (job.input_manifest ?? []) as RenderManifestItem[]
        );
      } catch {
        continue;
      }
      if (
        isCanonicalRenderOutputPath(objectName, project.creator_id, project.id, job.id)
      ) {
        return true;
      }
    }
    return false;
  }

  public canCleanupRenderOutputObject(
    objectName: string,
    workerId: string,
    callerId: string = workerId
  ): boolean {
    if (!objectName || !workerId || !callerId || workerId !== callerId) return false;
    if (!this.isAuthorizedRenderWorker(workerId, callerId)) return false;
    for (const job of this.state.renderJobs.values()) {
      if (job.claimed_by !== callerId) continue;
      if (job.status !== "processing" && job.status !== "failed") continue;
      const project = this.state.projects.get(job.project_id);
      if (!project) continue;
      if (
        isCanonicalRenderOutputPath(objectName, project.creator_id, project.id, job.id)
      ) {
        return true;
      }
    }
    return false;
  }

  public validateManifestIntegrity(projectId: string, manifest: RenderManifestItem[]): void {
    const project = this.state.projects.get(projectId);
    if (!project) {
      throw new Error("Collaborative project not found.");
    }
    if (
      !this.isAccountActive(project.creator_id) ||
      this.isAccountRestricted(project.creator_id)
    ) {
      throw new Error("Project owner account is deactivated or restricted.");
    }
    if (!Array.isArray(manifest) || manifest.length === 0) {
      throw new Error(
        "Render job requires a non-empty input_manifest of approved contributions."
      );
    }

    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    const seenDbOrders = new Set<number>();

    for (const item of manifest) {
      if (!item.contribution_id || !item.sequence_order || item.sequence_order < 1) {
        throw new Error(
          "Every manifest item must include a valid contribution_id and positive sequence_order."
        );
      }
      if (seenIds.has(item.contribution_id)) {
        throw new Error("Duplicate contribution_id in render manifest.");
      }
      if (seenOrders.has(item.sequence_order)) {
        throw new Error("Duplicate sequence_order in render manifest.");
      }
      seenIds.add(item.contribution_id);
      seenOrders.add(item.sequence_order);

      const pc = this.state.contributions.get(item.contribution_id);
      if (!pc || pc.project_id !== projectId) {
        throw new Error(
          `Contribution ${item.contribution_id} does not belong to project ${projectId}.`
        );
      }
      if (
        pc.review_status !== "approved" ||
        pc.consent_granted !== true ||
        pc.consent_withdrawn_at !== null
      ) {
        throw new Error(
          `Contribution ${item.contribution_id} is not approved or lacks active contributor consent.`
        );
      }
      if (pc.consent_policy_version !== project.consent_policy_version) {
        throw new Error(
          `Contribution ${item.contribution_id} consent_policy_version does not match project policy version.`
        );
      }
      if (
        !this.isActiveProjectParticipantInternal(projectId, pc.contributor_id) ||
        this.isBlocked(project.creator_id, pc.contributor_id) ||
        !this.isAccountActive(pc.contributor_id) ||
        this.isAccountRestricted(pc.contributor_id)
      ) {
        throw new Error(
          `Contributor for ${item.contribution_id} is no longer an active eligible participant.`
        );
      }
      if (
        pc.media_path !== item.media_path ||
        pc.contributor_id !== item.contributor_id ||
        pc.sequence_order === null ||
        pc.sequence_order !== item.sequence_order ||
        seenDbOrders.has(pc.sequence_order)
      ) {
        throw new Error(
          `Manifest item for contribution ${item.contribution_id} does not match authoritative contribution record.`
        );
      }
      seenDbOrders.add(pc.sequence_order);
      if (!isAuthorizedContributionMediaPath(pc.media_path, pc.contributor_id)) {
        throw new Error(
          `Contribution ${item.contribution_id} media_path does not match contributor storage namespace.`
        );
      }
    }
  }

  /**
   * Simulates the database consent-withdrawal trigger (`handle_project_contribution_update`)
   * which invalidates active render jobs and clears project output if consent is revoked.
   */
  public withdrawContributionConsent(contributionId: string, actorUserId: string): void {
    const pc = this.state.contributions.get(contributionId);
    if (!pc) throw new Error("Contribution not found.");
    if (pc.contributor_id !== actorUserId) {
      throw new Error("Only the contributor can withdraw consent.");
    }
    pc.consent_granted = false;
    pc.consent_withdrawn_at = new Date().toISOString();
    pc.review_status = "withdrawn";
    pc.sequence_order = null;

    // Trigger effect: mark any queued/processing render jobs referencing this contribution as failed
    for (const job of this.state.renderJobs.values()) {
      if (
        job.project_id === pc.project_id &&
        (job.status === "queued" || job.status === "processing")
      ) {
        job.status = "failed";
        job.failure_reason = "Aborted due to contributor consent withdrawal.";
        job.completed_at = new Date().toISOString();
      }
    }

    const project = this.state.projects.get(pc.project_id);
    if (project && (project.status === "rendering" || project.status === "completed")) {
      project.status = "locked";
      project.output_media_path = null;
      project.output_provenance = null;
    }
  }

  public cancelProject(projectId: string, actorUserId: string): void {
    if (!this.isProjectEditor(projectId, actorUserId)) {
      throw new Error("Unauthorized to cancel project.");
    }
    const project = this.state.projects.get(projectId);
    if (!project) throw new Error("Project not found.");
    project.status = "cancelled";
    project.output_media_path = null;
    project.output_provenance = null;

    for (const job of this.state.renderJobs.values()) {
      if (
        job.project_id === projectId &&
        (job.status === "queued" || job.status === "processing")
      ) {
        job.status = "failed";
        job.failure_reason = "Project was cancelled.";
        job.completed_at = new Date().toISOString();
      }
    }
  }

  public applyRenderJobUpdate(
    actorUserId: string,
    jobId: string,
    patch: Partial<ProjectRenderJob>
  ): ProjectRenderJob {
    const oldJob = this.state.renderJobs.get(jobId);
    if (!oldJob) throw new Error("Render job not found.");

    const isEditor = this.isProjectEditor(oldJob.project_id, actorUserId);
    const isWorker = this.isAuthorizedRenderWorker(actorUserId);

    if (!isEditor && !isWorker) {
      throw new Error(
        "Only project editors or authorized render workers can update render job status."
      );
    }

    const newJob: ProjectRenderJob = {
      ...oldJob,
      ...patch,
      id: oldJob.id,
      project_id: oldJob.project_id,
      requested_by: oldJob.requested_by,
      idempotency_key: oldJob.idempotency_key,
      input_manifest: oldJob.input_manifest,
    };

    const project = this.state.projects.get(oldJob.project_id);
    if (!project) throw new Error("Collaborative project not found.");

    if (oldJob.status === "completed") {
      throw new Error("Completed render jobs are immutable.");
    }

    if (oldJob.status === "queued" && newJob.status === "processing") {
      if (!isWorker && !isEditor) {
        throw new Error(
          "Unauthorized to transition render job from queued to processing."
        );
      }
      if (project.status !== "rendering") {
        throw new Error(
          "Cannot start processing render job when project is not in rendering state."
        );
      }
      if (oldJob.attempt_count >= oldJob.max_attempts) {
        throw new Error("Render job has exhausted max_attempts.");
      }
      this.validateManifestIntegrity(
        oldJob.project_id,
        oldJob.input_manifest as RenderManifestItem[]
      );
      newJob.claimed_by = actorUserId;
      newJob.attempt_count = oldJob.attempt_count + 1;
      newJob.started_at = new Date().toISOString();
      newJob.completed_at = null;
      newJob.failure_reason = null;
    } else if (oldJob.status === "processing" && newJob.status === "completed") {
      if (oldJob.claimed_by !== null && oldJob.claimed_by !== actorUserId) {
        throw new Error(
          "Only the worker session that claimed this render job may mark it completed."
        );
      }
      if (!isWorker && !isEditor) {
        throw new Error("Unauthorized to complete render job.");
      }
      if (project.status !== "rendering") {
        throw new Error(
          "Cannot complete render job because project is no longer in rendering state."
        );
      }
      if (!newJob.output_media_path || newJob.output_media_path.trim() === "") {
        throw new Error("Completed render job requires a valid output_media_path.");
      }
      if (
        !isCanonicalRenderOutputPath(
          newJob.output_media_path,
          project.creator_id,
          oldJob.project_id,
          oldJob.id
        )
      ) {
        throw new Error(
          "Completed render job output_media_path must match canonical format {project_creator_id}/stitched-{project_id}-{job_id}-{hex8}.mp4."
        );
      }
      this.validateManifestIntegrity(
        oldJob.project_id,
        oldJob.input_manifest as RenderManifestItem[]
      );
      newJob.claimed_by = oldJob.claimed_by;
      newJob.completed_at = new Date().toISOString();
      newJob.failure_reason = null;
    } else if (
      (oldJob.status === "queued" || oldJob.status === "processing") &&
      newJob.status === "failed"
    ) {
      if (oldJob.status === "processing") {
        if (
          oldJob.claimed_by !== null &&
          oldJob.claimed_by !== actorUserId &&
          !isEditor
        ) {
          throw new Error(
            "Only the claiming worker or a project editor can mark a processing render job as failed."
          );
        }
      } else {
        if (!isWorker && !isEditor) {
          throw new Error("Unauthorized to mark queued render job as failed.");
        }
      }
      newJob.claimed_by = oldJob.claimed_by;
      newJob.completed_at = new Date().toISOString();
      newJob.output_media_path = null;
      newJob.output_provenance = null;
      if (!newJob.failure_reason || newJob.failure_reason.trim() === "") {
        newJob.failure_reason = "Render job failed or timed out.";
      }
    } else if (oldJob.status === "failed" && newJob.status === "queued") {
      if (!isEditor) {
        throw new Error("Only project editors can retry a failed render job.");
      }
      if (oldJob.attempt_count >= oldJob.max_attempts) {
        throw new Error(
          "Render job has reached max_attempts and cannot be retried."
        );
      }
      if (project.status !== "rendering" && project.status !== "locked") {
        throw new Error(
          "Project must be locked or rendering to retry a failed render job."
        );
      }
      this.validateManifestIntegrity(
        oldJob.project_id,
        oldJob.input_manifest as RenderManifestItem[]
      );
      newJob.claimed_by = null;
      newJob.started_at = null;
      newJob.completed_at = null;
      newJob.failure_reason = null;
      newJob.output_media_path = null;
      newJob.output_provenance = null;
    } else if (oldJob.status !== newJob.status) {
      throw new Error(
        `Invalid render job status transition from ${oldJob.status} to ${newJob.status}.`
      );
    }

    this.state.renderJobs.set(jobId, newJob);

    // AFTER UPDATE trigger syncs collaborative_projects status & output_media_path
    if (newJob.status === "completed") {
      project.status = "completed";
      project.output_media_path = newJob.output_media_path;
      project.output_provenance = {
        schema_version: "1.0",
        transparency_label: "no_ai_declared",
        clip_count: newJob.input_manifest.length,
      };
    } else if (oldJob.status !== "failed" && newJob.status === "failed") {
      if (project.status === "rendering") {
        project.status = "locked";
      }
    } else if (oldJob.status === "failed" && newJob.status === "queued") {
      if (project.status === "locked") {
        project.status = "rendering";
      }
    }

    return { ...newJob };
  }

  /**
   * Creates an authenticated SupabaseClient facade bound to `actorUserId`
   * that enforces all RLS policies and triggers on every query, RPC, and Storage call.
   */
  public createClientForUser(actorUserId: string): SupabaseClient<Database> {
    const buildSelectChain = (tableName: string) => {
      const eqFilters: Array<[string, unknown]> = [];
      const inFilters: Array<[string, unknown[]]> = [];

      const executeSelect = () => {
        if (tableName === "collaborative_projects") {
          const rows = Array.from(this.state.projects.values()).filter((p) => {
            // `collaborative_projects_select_policy` (FOR SELECT TO PUBLIC)
            const publicPolicyAllowed = this.canViewProject(
              p.id,
              actorUserId,
              actorUserId
            );
            // `collaborative_projects_worker_select_policy` (FOR SELECT TO authenticated)
            const authenticatedWorkerOrCreatorPolicyAllowed =
              Boolean(actorUserId) &&
              ((p.creator_id === actorUserId &&
                !this.isDedicatedRenderWorkerOnly(actorUserId, actorUserId)) ||
                this.isWorkerProcessingProject(p.id, actorUserId, actorUserId));
            if (!publicPolicyAllowed && !authenticatedWorkerOrCreatorPolicyAllowed) {
              return false;
            }
            return matchesFilters(p, eqFilters, inFilters);
          });
          return { data: rows.map((r) => ({ ...r })), error: null };
        }

        if (tableName === "project_contributions") {
          const rows = Array.from(this.state.contributions.values()).filter((c) => {
            const nonWorkerAllowed =
              !this.isDedicatedRenderWorkerOnly(actorUserId, actorUserId) &&
              (c.contributor_id === actorUserId ||
                this.isProjectEditor(c.project_id, actorUserId, actorUserId) ||
                (c.review_status === "approved" &&
                  c.consent_granted === true &&
                  c.consent_withdrawn_at === null &&
                  this.canViewProject(c.project_id, actorUserId, actorUserId)));
            const workerAllowed =
              c.review_status === "approved" &&
              c.consent_granted === true &&
              c.consent_withdrawn_at === null &&
              this.isContributionInActiveWorkerManifest(
                c.project_id,
                c.id,
                actorUserId,
                actorUserId
              );
            if (!nonWorkerAllowed && !workerAllowed) return false;
            return matchesFilters(c, eqFilters, inFilters);
          });
          return { data: rows.map((r) => ({ ...r })), error: null };
        }

        if (tableName === "project_render_jobs") {
          const rows = Array.from(this.state.renderJobs.values()).filter((j) => {
            const rlsAllowed =
              (!this.isDedicatedRenderWorkerOnly(actorUserId, actorUserId) &&
                this.canViewProject(j.project_id, actorUserId, actorUserId)) ||
              (this.isAuthorizedRenderWorker(actorUserId, actorUserId) &&
                j.claimed_by === actorUserId);
            if (!rlsAllowed) return false;
            return matchesFilters(j, eqFilters, inFilters);
          });
          return { data: rows.map((r) => ({ ...r })), error: null };
        }

        if (tableName === "posts") {
          const rows = Array.from(this.state.posts.values()).filter((post) => {
            if (this.isDedicatedRenderWorkerOnly(actorUserId, actorUserId)) {
              return false;
            }
            const status = post.status ?? "published";
            const creatorActive =
              this.isAccountActive(post.creator_id) &&
              !this.isAccountRestricted(post.creator_id);
            const viewerActive =
              this.isAccountActive(actorUserId) &&
              !this.isAccountRestricted(actorUserId);
            const rlsAllowed =
              post.creator_id === actorUserId ||
              (status === "published" &&
                !post.is_restricted &&
                creatorActive &&
                viewerActive &&
                !this.isBlocked(post.creator_id, actorUserId) &&
                (post.visibility === "public" ||
                  (post.visibility === "followers" &&
                    this.isAcceptedFollower(actorUserId, post.creator_id))));
            if (!rlsAllowed) return false;
            return matchesFilters(post, eqFilters, inFilters);
          });
          return { data: rows.map((r) => ({ ...r })), error: null };
        }

        return { data: [], error: null };
      };

      const chain = {
        eq(col: string, val: unknown) {
          eqFilters.push([col, val]);
          return chain;
        },
        in(col: string, vals: unknown[]) {
          inFilters.push([col, vals]);
          return chain;
        },
        async maybeSingle() {
          const res = executeSelect();
          return { data: res.data[0] ?? null, error: res.error };
        },
        async single() {
          const res = executeSelect();
          if (!res.data[0]) {
            return { data: null, error: { message: "Row not found" } };
          }
          return { data: res.data[0], error: null };
        },
        // Allow awaiting the chain directly
        // biome-ignore lint/suspicious/noThenProperty: Supabase PostgrestFilterBuilder is thenable
        then(
          onfulfilled?: (value: { data: unknown[]; error: null }) => unknown
        ) {
          return Promise.resolve(executeSelect()).then(onfulfilled);
        },
      };

      return chain;
    };

    const buildUpdateChain = (tableName: string, patch: Record<string, unknown>) => {
      const eqFilters: Array<[string, unknown]> = [];
      const inFilters: Array<[string, unknown[]]> = [];

      const executeUpdate = () => {
        if (tableName !== "project_render_jobs") {
          return {
            data: null,
            error: { message: `Updates on ${tableName} not supported in simulator.` },
          };
        }

        const matchingJobs = Array.from(this.state.renderJobs.values()).filter(
          (j) => matchesFilters(j, eqFilters, inFilters)
        );

        if (matchingJobs.length === 0) {
          return { data: null, error: null };
        }

        try {
          const target = matchingJobs[0]!;
          // Verify UPDATE RLS policy
          const rlsAllowed =
            this.isProjectEditor(target.project_id, actorUserId, actorUserId) ||
            (this.isAuthorizedRenderWorker(actorUserId, actorUserId) &&
              (target.status === "queued" || target.claimed_by === actorUserId));
          if (!rlsAllowed) {
            return {
              data: null,
              error: {
                message: "new row violates row-level security policy for table \"project_render_jobs\"",
              },
            };
          }

          const updated = this.applyRenderJobUpdate(
            actorUserId,
            target.id,
            patch as Partial<ProjectRenderJob>
          );
          return { data: updated, error: null };
        } catch (err: unknown) {
          return {
            data: null,
            error: {
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      };

      const updateChain = {
        eq(col: string, val: unknown) {
          eqFilters.push([col, val]);
          return updateChain;
        },
        in(col: string, vals: unknown[]) {
          inFilters.push([col, vals]);
          return updateChain;
        },
        select() {
          return {
            async maybeSingle() {
              return executeUpdate();
            },
            async single() {
              const res = executeUpdate();
              if (!res.error && !res.data) {
                return { data: null, error: { message: "Row not found" } };
              }
              return res;
            },
          };
        },
        // biome-ignore lint/suspicious/noThenProperty: Supabase PostgrestFilterBuilder is thenable
        then(
          onfulfilled?: (value: {
            data: ProjectRenderJob | null;
            error: { message: string } | null;
          }) => unknown
        ) {
          return Promise.resolve(executeUpdate()).then(onfulfilled);
        },
      };

      return updateChain;
    };

    const client = {
      from: (tableName: string) => ({
        select: () => buildSelectChain(tableName),
        update: (patch: Record<string, unknown>) =>
          buildUpdateChain(tableName, patch),
      }),
      rpc: async (fnName: string, args?: Record<string, unknown>) => {
        if (fnName === "is_authorized_render_worker") {
          const targetUserId = (args?.u_id as string) ?? "";
          return {
            data: this.isAuthorizedRenderWorker(targetUserId, actorUserId),
            error: null,
          };
        }

        if (fnName === "is_dedicated_render_worker_only") {
          const targetUserId = (args?.u_id as string) ?? "";
          return {
            data: this.isDedicatedRenderWorkerOnly(targetUserId, actorUserId),
            error: null,
          };
        }

        if (fnName === "is_worker_processing_project") {
          const projId = (args?.p_project_id as string) ?? "";
          const workerId = (args?.p_worker_id as string) ?? "";
          return {
            data: this.isWorkerProcessingProject(projId, workerId, actorUserId),
            error: null,
          };
        }

        if (fnName === "is_contribution_in_active_worker_manifest") {
          const projId = (args?.p_project_id as string) ?? "";
          const contribId = (args?.p_contribution_id as string) ?? "";
          const workerId = (args?.p_worker_id as string) ?? "";
          return {
            data: this.isContributionInActiveWorkerManifest(
              projId,
              contribId,
              workerId,
              actorUserId
            ),
            error: null,
          };
        }

        if (fnName === "is_media_in_active_worker_manifest") {
          const mediaPath = (args?.p_media_path as string) ?? "";
          const workerId = (args?.p_worker_id as string) ?? "";
          return {
            data: this.isMediaInActiveWorkerManifest(
              mediaPath,
              workerId,
              actorUserId
            ),
            error: null,
          };
        }

        if (fnName === "can_upload_render_output_object") {
          const objectName = (args?.p_object_name as string) ?? "";
          const workerId = (args?.p_worker_id as string) ?? "";
          return {
            data: this.canUploadRenderOutputObject(
              objectName,
              workerId,
              actorUserId
            ),
            error: null,
          };
        }

        if (fnName === "can_cleanup_render_output_object") {
          const objectName = (args?.p_object_name as string) ?? "";
          const workerId = (args?.p_worker_id as string) ?? "";
          return {
            data: this.canCleanupRenderOutputObject(
              objectName,
              workerId,
              actorUserId
            ),
            error: null,
          };
        }

        if (fnName === "can_view_project") {
          const projId = (args?.p_id as string) ?? "";
          const targetUserId = (args?.u_id as string) ?? "";
          return {
            data: this.canViewProject(projId, targetUserId, actorUserId),
            error: null,
          };
        }

        if (fnName === "is_project_editor") {
          const projId = (args?.p_id as string) ?? "";
          const targetUserId = (args?.u_id as string) ?? "";
          return {
            data: this.isProjectEditor(projId, targetUserId, actorUserId),
            error: null,
          };
        }

        if (fnName === "is_project_active_participant") {
          const projId = (args?.p_id as string) ?? "";
          const targetUserId = (args?.u_id as string) ?? "";
          return {
            data: this.isProjectActiveParticipant(
              projId,
              targetUserId,
              actorUserId
            ),
            error: null,
          };
        }

        if (fnName === "is_active_project_participant_internal") {
          return {
            data: null,
            error: {
              message:
                "permission denied for function is_active_project_participant_internal",
            },
          };
        }

        if (fnName === "is_canonical_render_output_path") {
          return {
            data: null,
            error: {
              message:
                "permission denied for function is_canonical_render_output_path",
            },
          };
        }

        if (fnName === "claim_project_render_job") {
          const requestedJobId = (args?.p_job_id as string | null) ?? null;
          if (!actorUserId) {
            return {
              data: null,
              error: { message: "Authentication required to claim render jobs." },
            };
          }

          const isWorker = this.isAuthorizedRenderWorker(actorUserId, actorUserId);
          if (requestedJobId !== null) {
            const target = this.state.renderJobs.get(requestedJobId);
            const isTargetEditor = target
              ? this.isProjectEditor(target.project_id, actorUserId, actorUserId)
              : false;
            if (!isWorker && !isTargetEditor) {
              return {
                data: null,
                error: {
                  message: "Unauthorized: actor is not authorized to claim this render job.",
                },
              };
            }
          } else if (!isWorker) {
            // Check if editor of any queued job
            const hasEditorQueuedJob = Array.from(
              this.state.renderJobs.values()
            ).some(
              (j) =>
                j.status === "queued" &&
                this.isProjectEditor(j.project_id, actorUserId, actorUserId)
            );
            if (!hasEditorQueuedJob) {
              return {
                data: null,
                error: {
                  message:
                    "Unauthorized: only active render workers or authorized project editors can claim render jobs.",
                },
              };
            }
          }

          // Simulate FOR UPDATE SKIP LOCKED across queued jobs ordered by created_at ASC
          const candidates = Array.from(this.state.renderJobs.values())
            .filter((j) => {
              if (j.status !== "queued") return false;
              if (j.attempt_count >= j.max_attempts) return false;
              if (requestedJobId !== null && j.id !== requestedJobId) return false;
              const proj = this.state.projects.get(j.project_id);
              if (!proj || proj.status !== "rendering") return false;
              if (!isWorker && !this.isProjectEditor(j.project_id, actorUserId, actorUserId)) {
                return false;
              }
              // SKIP LOCKED check
              if (this.state.activeClaimLocks.has(j.id)) return false;
              return true;
            })
            .sort((a, b) => a.created_at.localeCompare(b.created_at));

          const candidate = candidates[0];
          if (!candidate) {
            return { data: [], error: null };
          }

          this.state.activeClaimLocks.add(candidate.id);
          try {
            const updated = this.applyRenderJobUpdate(actorUserId, candidate.id, {
              status: "processing",
            });
            return { data: [updated], error: null };
          } catch (err: unknown) {
            return {
              data: null,
              error: {
                message: err instanceof Error ? err.message : String(err),
              },
            };
          } finally {
            this.state.activeClaimLocks.delete(candidate.id);
          }
        }

        if (fnName === "fail_invalid_queued_render_job") {
          const jobId = args?.p_job_id as string;
          const reason =
            (args?.p_failure_reason as string | null) ??
            "Render job failed manifest or consent validation.";
          const job = this.state.renderJobs.get(jobId);
          if (!job) return { data: false, error: null };
          if (
            !this.isAuthorizedRenderWorker(actorUserId, actorUserId) &&
            !this.isProjectEditor(job.project_id, actorUserId, actorUserId)
          ) {
            return {
              data: null,
              error: {
                message:
                  "Unauthorized: only active render workers or project editors can fail an invalid queued render job.",
              },
            };
          }
          if (job.status !== "queued") {
            return { data: false, error: null };
          }
          try {
            this.applyRenderJobUpdate(actorUserId, jobId, {
              status: "failed",
              failure_reason: reason,
            });
            return { data: true, error: null };
          } catch (err: unknown) {
            return {
              data: null,
              error: {
                message: err instanceof Error ? err.message : String(err),
              },
            };
          }
        }

        return {
          data: null,
          error: { message: `Unsupported RPC: ${fnName}` },
        };
      },
      storage: {
        from: (bucketId: string) => ({
          createSignedUrl: async (objectName: string) => {
            if (bucketId !== "media") {
              return { data: null, error: { message: "Invalid bucket" } };
            }
            const exists = this.state.storageObjects.has(objectName);
            if (!exists) {
              return { data: null, error: { message: "Object not found" } };
            }

            // Branch 1: Claiming render worker reading manifest-authorized clip
            const isWorkerManifestRead = this.isMediaInActiveWorkerManifest(
              objectName,
              actorUserId,
              actorUserId
            );

            // Branches 2-5: General user media reads (explicitly exclude dedicated render workers,
            // deactivated viewers, and restricted viewers)
            let isGeneralViewerAuthorized = false;
            if (
              !this.isDedicatedRenderWorkerOnly(actorUserId, actorUserId) &&
              this.isAccountActive(actorUserId) &&
              !this.isAccountRestricted(actorUserId)
            ) {
              const parts = objectName.split("/");
              const topFolder = parts[0] ?? "";
              const secondSegment = parts[1] ?? "";
              const isOwnFolder =
                topFolder === actorUserId &&
                !secondSegment.startsWith("stitched-");

              let isAuthorizedPostMedia = false;
              for (const post of this.state.posts.values()) {
                if (post.media_url !== objectName) continue;
                if (
                  !this.isAccountActive(post.creator_id) ||
                  this.isAccountRestricted(post.creator_id)
                ) {
                  continue;
                }
                const postStatus = post.status ?? "published";
                if (post.creator_id === actorUserId) {
                  isAuthorizedPostMedia = true;
                  break;
                }
                if (
                  postStatus === "published" &&
                  !post.is_restricted &&
                  !this.isBlocked(post.creator_id, actorUserId) &&
                  (post.visibility === "public" ||
                    (post.visibility === "followers" &&
                      this.isAcceptedFollower(actorUserId, post.creator_id)))
                ) {
                  isAuthorizedPostMedia = true;
                  break;
                }
              }

              let isAuthorizedProjectContribution = false;
              for (const pc of this.state.contributions.values()) {
                if (pc.media_path !== objectName) continue;
                if (
                  !pc.consent_granted ||
                  pc.consent_withdrawn_at !== null ||
                  pc.review_status === "withdrawn"
                ) {
                  continue;
                }
                const proj = this.state.projects.get(pc.project_id);
                if (!proj) continue;
                if (
                  !this.isAccountActive(pc.contributor_id) ||
                  this.isAccountRestricted(pc.contributor_id) ||
                  !this.isAccountActive(proj.creator_id) ||
                  this.isAccountRestricted(proj.creator_id)
                ) {
                  continue;
                }
                if (this.isBlocked(actorUserId, pc.contributor_id)) continue;
                if (this.isBlocked(actorUserId, proj.creator_id)) continue;
                if (!this.canViewProject(pc.project_id, actorUserId, actorUserId)) {
                  continue;
                }
                if (
                  pc.contributor_id === actorUserId ||
                  pc.review_status === "approved" ||
                  (pc.review_status === "pending" &&
                    this.isProjectActiveParticipant(
                      pc.project_id,
                      actorUserId,
                      actorUserId
                    ))
                ) {
                  isAuthorizedProjectContribution = true;
                  break;
                }
              }

              let isAuthorizedProjectOutput = false;
              for (const proj of this.state.projects.values()) {
                if (
                  proj.output_media_path === objectName &&
                  proj.status === "completed" &&
                  this.isAccountActive(proj.creator_id) &&
                  !this.isAccountRestricted(proj.creator_id) &&
                  !this.isBlocked(proj.creator_id, actorUserId) &&
                  this.canViewProject(proj.id, actorUserId, actorUserId)
                ) {
                  isAuthorizedProjectOutput = true;
                  break;
                }
              }

              isGeneralViewerAuthorized =
                isOwnFolder ||
                isAuthorizedPostMedia ||
                isAuthorizedProjectContribution ||
                isAuthorizedProjectOutput;
            }

            if (!isWorkerManifestRead && !isGeneralViewerAuthorized) {
              return {
                data: null,
                error: {
                  message: "Object not found or access denied by storage RLS policy",
                },
              };
            }

            return {
              data: {
                signedUrl: `${this.signedUrlBase}/storage/${encodeURIComponent(objectName)}`,
              },
              error: null,
            };
          },
          upload: async (
            objectName: string,
            data: Buffer | Uint8Array | ArrayBuffer
          ) => {
            if (bucketId !== "media") {
              return { data: null, error: { message: "Invalid bucket" } };
            }
            const topFolder = objectName.split("/")[0] ?? "";
            const isNormalUserUploadAllowed =
              topFolder === actorUserId &&
              !this.isDedicatedRenderWorkerOnly(actorUserId);
            const isWorkerOutputUploadAllowed = this.canUploadRenderOutputObject(
              objectName,
              actorUserId
            );

            if (!isNormalUserUploadAllowed && !isWorkerOutputUploadAllowed) {
              return {
                data: null,
                error: {
                  message:
                    "new row violates row-level security policy for table \"objects\"",
                },
              };
            }

            if (this.state.storageObjects.has(objectName)) {
              return {
                data: null,
                error: { message: "The resource already exists" },
              };
            }

            const buf = Buffer.isBuffer(data)
              ? data
              : data instanceof Uint8Array
                ? Buffer.from(data)
                : Buffer.from(data);
            this.state.storageObjects.set(objectName, buf);
            return { data: { path: objectName }, error: null };
          },
          remove: async (objectNames: string[]) => {
            if (bucketId !== "media") {
              return { data: null, error: { message: "Invalid bucket" } };
            }
            const removed: string[] = [];
            for (const name of objectNames) {
              const topFolder = name.split("/")[0] ?? "";
              const canDeleteOwn =
                topFolder === actorUserId &&
                !this.isDedicatedRenderWorkerOnly(actorUserId);
              const canDeleteWorkerOutput = this.canCleanupRenderOutputObject(
                name,
                actorUserId
              );
              if (!canDeleteOwn && !canDeleteWorkerOutput) {
                return {
                  data: null,
                  error: {
                    message:
                      "delete violates row-level security policy for table \"objects\"",
                  },
                };
              }
              if (this.state.storageObjects.delete(name)) {
                removed.push(name);
              }
            }
            return { data: removed, error: null };
          },
        }),
      },
    };

    return client as unknown as SupabaseClient<Database>;
  }
}

describe("Milestone 4.5 — P0-2: Secure Multi-User Render Worker", () => {
  let tempFixturesDir: string;
  let clipRedBytes: Buffer;
  let clipBlueBytes: Buffer;
  let server: http.Server;
  let serverBaseUrl: string;
  let activeSim: MultiUserSupabaseSimulator | null = null;

  beforeAll(async () => {
    tempFixturesDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "hiha-p02-worker-fixtures-")
    );
    const redPath = path.join(tempFixturesDir, "red.mp4");
    const bluePath = path.join(tempFixturesDir, "blue.mp4");

    await generateSyntheticVideoClip(redPath, {
      color: "red",
      width: 320,
      height: 240,
      durationSeconds: 1.0,
      withAudio: true,
    });
    await generateSyntheticVideoClip(bluePath, {
      color: "blue",
      width: 320,
      height: 240,
      durationSeconds: 1.0,
      withAudio: false,
    });

    clipRedBytes = await fs.readFile(redPath);
    clipBlueBytes = await fs.readFile(bluePath);

    server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith("/storage/") || !activeSim) {
        res.writeHead(404);
        res.end();
        return;
      }
      const objectPath = decodeURIComponent(req.url.slice("/storage/".length));
      const payload = activeSim.state.storageObjects.get(objectPath);
      if (!payload) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": String(payload.byteLength),
      });
      res.end(payload);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    serverBaseUrl = `http://127.0.0.1:${port}`;
  }, 45_000);

  afterEach(() => {
    activeSim = null;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (tempFixturesDir) {
      await fs.rm(tempFixturesDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function setupStandardMultiUserState(): MultiUserSupabaseSimulator {
    const sim = new MultiUserSupabaseSimulator(serverBaseUrl);
    activeSim = sim;

    // Profiles
    sim.state.profiles.set(USER_A_ID, {
      id: USER_A_ID,
      account_status: "active",
      is_private: true,
    });
    sim.state.profiles.set(USER_B_ID, {
      id: USER_B_ID,
      account_status: "active",
      is_private: true,
    });
    sim.state.profiles.set(USER_C_ID, {
      id: USER_C_ID,
      account_status: "active",
      is_private: true,
    });
    sim.state.profiles.set(USER_D_ID, {
      id: USER_D_ID,
      account_status: "active",
      is_private: true,
    });
    sim.state.profiles.set(WORKER_2_ID, {
      id: WORKER_2_ID,
      account_status: "active",
      is_private: true,
    });

    // Dedicated render workers (NOT in platform_staff, NOT participants in Project B or C)
    sim.state.renderWorkers.set(USER_A_ID, {
      user_id: USER_A_ID,
      worker_name: "worker-primary",
      is_active: true,
      allow_user_uploads: false,
    });
    sim.state.renderWorkers.set(WORKER_2_ID, {
      user_id: WORKER_2_ID,
      worker_name: "worker-secondary",
      is_active: true,
      allow_user_uploads: false,
    });

    // Private Project B owned by User B, with User C as contributor
    sim.state.projects.set(PROJECT_B_ID, {
      id: PROJECT_B_ID,
      creator_id: USER_B_ID,
      community_id: null,
      title: "User B Private Collaborative Project",
      status: "rendering",
      visibility: "private",
      participation_mode: "invite_only",
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      output_media_path: null,
      output_provenance: null,
    });

    sim.state.participants.push(
      {
        project_id: PROJECT_B_ID,
        user_id: USER_B_ID,
        role: "owner",
        status: "active",
      },
      {
        project_id: PROJECT_B_ID,
        user_id: USER_C_ID,
        role: "contributor",
        status: "active",
      }
    );

    const mediaPathB1 = `${USER_B_ID}/clip-b1-red.mp4`;
    const mediaPathB2 = `${USER_C_ID}/clip-b2-blue.mp4`;
    sim.state.storageObjects.set(mediaPathB1, clipRedBytes);
    sim.state.storageObjects.set(mediaPathB2, clipBlueBytes);

    const consentTime = "2026-10-10T00:00:00.000Z";
    sim.state.contributions.set(CONTRIB_B1_ID, {
      id: CONTRIB_B1_ID,
      project_id: PROJECT_B_ID,
      contributor_id: USER_B_ID,
      media_path: mediaPathB1,
      media_type: "short_video",
      review_status: "approved",
      consent_granted: true,
      consent_granted_at: consentTime,
      consent_withdrawn_at: null,
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      sequence_order: 1,
      ai_disclosure_status: "no_ai_declared",
    });

    sim.state.contributions.set(CONTRIB_B2_ID, {
      id: CONTRIB_B2_ID,
      project_id: PROJECT_B_ID,
      contributor_id: USER_C_ID,
      media_path: mediaPathB2,
      media_type: "short_video",
      review_status: "approved",
      consent_granted: true,
      consent_granted_at: consentTime,
      consent_withdrawn_at: null,
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      sequence_order: 2,
      ai_disclosure_status: "no_ai_declared",
    });

    sim.state.renderJobs.set(JOB_B_ID, {
      id: JOB_B_ID,
      project_id: PROJECT_B_ID,
      requested_by: USER_B_ID,
      idempotency_key: "render-job-b-1",
      status: "queued",
      input_manifest: [
        {
          contribution_id: CONTRIB_B1_ID,
          contributor_id: USER_B_ID,
          media_path: mediaPathB1,
          media_type: "short_video",
          sequence_order: 1,
          consent_granted_at: consentTime,
          consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
          ai_disclosure_status: "no_ai_declared",
        },
        {
          contribution_id: CONTRIB_B2_ID,
          contributor_id: USER_C_ID,
          media_path: mediaPathB2,
          media_type: "short_video",
          sequence_order: 2,
          consent_granted_at: consentTime,
          consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
          ai_disclosure_status: "no_ai_declared",
        },
      ],
      output_media_path: null,
      output_provenance: null,
      claimed_by: null,
      attempt_count: 0,
      max_attempts: 3,
      timeout_seconds: 120,
      failure_reason: null,
      started_at: null,
      completed_at: null,
      created_at: "2026-10-10T01:00:00.000Z",
      updated_at: "2026-10-10T01:00:00.000Z",
    });

    // Unrelated Private Project C owned by User C
    sim.state.projects.set(PROJECT_C_ID, {
      id: PROJECT_C_ID,
      creator_id: USER_C_ID,
      community_id: null,
      title: "User C Secret Unclaimed Project",
      status: "locked",
      visibility: "private",
      participation_mode: "invite_only",
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      output_media_path: null,
      output_provenance: null,
    });
    sim.state.participants.push({
      project_id: PROJECT_C_ID,
      user_id: USER_C_ID,
      role: "owner",
      status: "active",
    });

    const mediaPathC1 = `${USER_C_ID}/secret-project-c-clip.mp4`;
    sim.state.storageObjects.set(mediaPathC1, clipBlueBytes);
    sim.state.contributions.set(CONTRIB_C1_ID, {
      id: CONTRIB_C1_ID,
      project_id: PROJECT_C_ID,
      contributor_id: USER_C_ID,
      media_path: mediaPathC1,
      media_type: "short_video",
      review_status: "approved",
      consent_granted: true,
      consent_granted_at: consentTime,
      consent_withdrawn_at: null,
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      sequence_order: 1,
      ai_disclosure_status: "no_ai_declared",
    });

    // Unrelated private post owned by User C
    const privatePostMediaPath = `${USER_C_ID}/private-diary-video.mp4`;
    sim.state.storageObjects.set(privatePostMediaPath, clipRedBytes);
    sim.state.posts.set(PRIVATE_POST_C_ID, {
      id: PRIVATE_POST_C_ID,
      creator_id: USER_C_ID,
      visibility: "private",
      media_url: privatePostMediaPath,
    });

    return sim;
  }

  it("1. Multi-user worker execution: non-participant render worker claims, downloads manifest clips, renders with FFmpeg, uploads canonical output under User B, and marks job/project completed", async () => {
    const sim = setupStandardMultiUserState();
    const workerClient = sim.createClientForUser(USER_A_ID);

    // Confirm worker (User A) is NOT a participant or editor of User B's private project
    expect(sim.isProjectActiveParticipant(PROJECT_B_ID, USER_A_ID)).toBe(false);
    expect(sim.isProjectEditor(PROJECT_B_ID, USER_A_ID)).toBe(false);
    expect(sim.isAuthorizedRenderWorker(USER_A_ID)).toBe(true);

    const result = await processProjectRenderJob(workerClient, USER_A_ID, {
      jobId: JOB_B_ID,
    });

    expect(result.claimed).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.jobId).toBe(JOB_B_ID);
    expect(result.projectId).toBe(PROJECT_B_ID);
    expect(result.failureReason).toBeNull();
    expect(result.tempDirCleanedUp).toBe(true);
    expect(result.outputMediaPath).toBeTruthy();

    const outputMediaPath = result.outputMediaPath!;
    // Must be stored under Project Owner (User B)'s canonical path, NOT Worker (User A)'s path
    expect(outputMediaPath.startsWith(`${USER_B_ID}/stitched-${PROJECT_B_ID}-${JOB_B_ID}-`)).toBe(true);
    expect(
      isCanonicalRenderOutputPath(outputMediaPath, USER_B_ID, PROJECT_B_ID, JOB_B_ID)
    ).toBe(true);

    // Verify rendered output exists in storage and has Red -> Blue frame ordering
    const uploadedBytes = sim.state.storageObjects.get(outputMediaPath);
    expect(uploadedBytes).toBeDefined();
    expect(uploadedBytes!.byteLength).toBeGreaterThan(1000);

    const verifyOutputTmp = path.join(tempFixturesDir, "verified_multiuser_out.mp4");
    await fs.writeFile(verifyOutputTmp, uploadedBytes!);
    const [rEarly, , bEarly] = await probeVideoFrameRgb(verifyOutputTmp, 0.4);
    const [rLate, , bLate] = await probeVideoFrameRgb(verifyOutputTmp, 1.4);
    expect(rEarly).toBeGreaterThan(bEarly + 80);
    expect(bLate).toBeGreaterThan(rLate + 80);

    // Verify database state updated for both job and project
    const finalJob = sim.state.renderJobs.get(JOB_B_ID)!;
    const finalProject = sim.state.projects.get(PROJECT_B_ID)!;
    expect(finalJob.status).toBe("completed");
    expect(finalJob.claimed_by).toBe(USER_A_ID);
    expect(finalJob.output_media_path).toBe(outputMediaPath);
    expect(finalProject.status).toBe("completed");
    expect(finalProject.output_media_path).toBe(outputMediaPath);

    // Verify Project Owner (User B) and Contributor (User C) can access the final rendered output via signed URL
    const userBClient = sim.createClientForUser(USER_B_ID);
    const userCClient = sim.createClientForUser(USER_C_ID);
    const { data: ownerSigned } = await userBClient.storage
      .from("media")
      .createSignedUrl(outputMediaPath, 60);
    const { data: contribSigned } = await userCClient.storage
      .from("media")
      .createSignedUrl(outputMediaPath, 60);
    expect(ownerSigned?.signedUrl).toBeTruthy();
    expect(contribSigned?.signedUrl).toBeTruthy();
  }, 45_000);

  it("2. Cross-project isolation: worker cannot read unrelated private posts, unrelated project contributions, or source clips from Project C during or after processing Project B", async () => {
    const sim = setupStandardMultiUserState();
    const workerClient = sim.createClientForUser(USER_A_ID);

    let midJobProjectCRead: unknown = null;
    let midJobContributionCRead: unknown = null;
    let midJobPrivatePostRead: unknown = null;
    let midJobProjectCSignedUrlErr: unknown = null;
    let midJobPrivatePostSignedUrlErr: unknown = null;

    const result = await processProjectRenderJob(workerClient, USER_A_ID, {
      jobId: JOB_B_ID,
      onAfterClaim: async () => {
        // While actively claiming & processing Project B:
        const projCRes = await workerClient
          .from("collaborative_projects")
          .select("*")
          .eq("id", PROJECT_C_ID)
          .maybeSingle();
        midJobProjectCRead = projCRes.data;

        const contribCRes = await workerClient
          .from("project_contributions")
          .select("*")
          .eq("id", CONTRIB_C1_ID)
          .maybeSingle();
        midJobContributionCRead = contribCRes.data;

        const postCRes = await workerClient
          .from("posts")
          .select("*")
          .eq("id", PRIVATE_POST_C_ID)
          .maybeSingle();
        midJobPrivatePostRead = postCRes.data;

        const clipCSign = await workerClient.storage
          .from("media")
          .createSignedUrl(`${USER_C_ID}/secret-project-c-clip.mp4`, 60);
        midJobProjectCSignedUrlErr = clipCSign.error;

        const postMediaSign = await workerClient.storage
          .from("media")
          .createSignedUrl(`${USER_C_ID}/private-diary-video.mp4`, 60);
        midJobPrivatePostSignedUrlErr = postMediaSign.error;
      },
    });

    expect(result.status).toBe("completed");
    expect(midJobProjectCRead).toBeNull();
    expect(midJobContributionCRead).toBeNull();
    expect(midJobPrivatePostRead).toBeNull();
    expect(midJobProjectCSignedUrlErr).toBeTruthy();
    expect(midJobPrivatePostSignedUrlErr).toBeTruthy();

    // After Project B job completes (`status = 'completed'`), worker also loses access to Project B's private source clips and project metadata!
    const postJobProjB = await workerClient
      .from("collaborative_projects")
      .select("*")
      .eq("id", PROJECT_B_ID)
      .maybeSingle();
    expect(postJobProjB.data).toBeNull();

    const postJobSourceClipSign = await workerClient.storage
      .from("media")
      .createSignedUrl(`${USER_C_ID}/clip-b2-blue.mp4`, 60);
    expect(postJobSourceClipSign.data).toBeNull();
    expect(postJobSourceClipSign.error).toBeTruthy();
  }, 45_000);

  it("3. Missing worker credentials fail closed without falling back to test_user_a@hiha.internal", async () => {
    // Unit-level verification of resolveWorkerRuntimeConfig
    expect(() =>
      resolveWorkerRuntimeConfig(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
          // RENDER_WORKER_EMAIL and RENDER_WORKER_PASSWORD intentionally omitted
        },
        []
      )
    ).toThrow(/RENDER_WORKER_EMAIL.*RENDER_WORKER_PASSWORD.*prohibited/i);

    expect(() =>
      resolveWorkerRuntimeConfig(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
          RENDER_WORKER_EMAIL: "worker@hiha.internal",
          RENDER_WORKER_PASSWORD: "   ",
        },
        []
      )
    ).toThrow(/RENDER_WORKER_EMAIL.*RENDER_WORKER_PASSWORD/i);

    // Inspect scripts/run-render-worker.mts source to confirm hardcoded fallback is completely removed
    const scriptSource = await fs.readFile(
      path.resolve(process.cwd(), "scripts/run-render-worker.mts"),
      "utf8"
    );
    expect(scriptSource).not.toContain("test_user_a@hiha.internal");
    expect(scriptSource).not.toContain("ValidPassword123!");
    expect(scriptSource).toContain("resolveWorkerRuntimeConfig");

    expect(() =>
      resolveWorkerRuntimeConfig(
        {
          NEXT_PUBLIC_SUPABASE_URL: "",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        },
        []
      )
    ).toThrow(/Missing required worker configuration/i);

    expect(() =>
      resolveWorkerRuntimeConfig(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy",
          RENDER_WORKER_EMAIL: "not-an-email",
          RENDER_WORKER_PASSWORD: "secret-password-value",
        },
        []
      )
    ).toThrow(/RENDER_WORKER_EMAIL must be a valid email/i);
  }, 30_000);

  it("4. Unauthorized user cannot act as worker: ordinary non-worker, non-editor user cannot claim queued jobs or mark jobs completed/failed", async () => {
    const sim = setupStandardMultiUserState();
    const unauthorizedClient = sim.createClientForUser(USER_D_ID);

    // Attempt to run processProjectRenderJob as User D
    const result = await processProjectRenderJob(unauthorizedClient, USER_D_ID, {
      jobId: JOB_B_ID,
    });
    expect(result.claimed).toBe(false);
    expect(result.status).toBe("skipped");
    expect(result.failureReason).toMatch(/Unauthorized/i);

    // Job B must still remain safely in 'queued' state for legitimate workers!
    const jobAfterUnauthorizedAttempt = sim.state.renderJobs.get(JOB_B_ID)!;
    expect(jobAfterUnauthorizedAttempt.status).toBe("queued");
    expect(jobAfterUnauthorizedAttempt.claimed_by).toBeNull();

    // Direct update attempt by User D to mark Job B completed or failed must also be rejected
    const directCompleteRes = await unauthorizedClient
      .from("project_render_jobs")
      .update({
        status: "completed",
        output_media_path: buildCanonicalRenderOutputPath(
          USER_B_ID,
          PROJECT_B_ID,
          JOB_B_ID,
          "deadbeef"
        ),
      })
      .eq("id", JOB_B_ID)
      .select()
      .maybeSingle();
    expect(directCompleteRes.error).toBeTruthy();

    // Contributor User C (who is a contributor, NOT an editor or render worker) also cannot claim or complete Job B
    const contributorClient = sim.createClientForUser(USER_C_ID);
    const contribClaimRes = await processProjectRenderJob(
      contributorClient,
      USER_C_ID,
      { jobId: JOB_B_ID }
    );
    expect(contribClaimRes.claimed).toBe(false);
    expect(sim.state.renderJobs.get(JOB_B_ID)!.status).toBe("queued");
  });

  it("5. Unconsented, withdrawn, blocked, or forged-path manifest clips are rejected before claim or completion", async () => {
    // Subcase 5A: Contribution is unapproved / unconsented while job is queued
    const simA = setupStandardMultiUserState();
    const contribB2 = simA.state.contributions.get(CONTRIB_B2_ID)!;
    contribB2.consent_granted = false;
    contribB2.consent_withdrawn_at = new Date().toISOString();
    contribB2.review_status = "withdrawn";

    const workerClientA = simA.createClientForUser(USER_A_ID);
    const resA = await processProjectRenderJob(workerClientA, USER_A_ID, {
      jobId: JOB_B_ID,
    });
    expect(resA.claimed).toBe(false);
    expect(resA.status).toBe("failed");
    expect(simA.state.renderJobs.get(JOB_B_ID)!.status).toBe("failed");

    // Subcase 5B: Contributor is blocked by Project Owner
    const simB = setupStandardMultiUserState();
    simB.state.blocks.push({
      blocker_id: USER_B_ID,
      blocked_id: USER_C_ID,
    });
    const workerClientB = simB.createClientForUser(USER_A_ID);
    const resB = await processProjectRenderJob(workerClientB, USER_A_ID, {
      jobId: JOB_B_ID,
    });
    expect(resB.claimed).toBe(false);
    expect(resB.status).toBe("failed");
    expect(simB.state.renderJobs.get(JOB_B_ID)!.status).toBe("failed");

    // Subcase 5C: Forged media_path pointing to another user's private storage folder
    const simC = setupStandardMultiUserState();
    const forgedPath = `${USER_D_ID}/stolen-private-clip.mp4`;
    simC.state.storageObjects.set(forgedPath, clipBlueBytes);
    simC.state.contributions.get(CONTRIB_B2_ID)!.media_path = forgedPath;
    simC.state.renderJobs.get(JOB_B_ID)!.input_manifest[1]!.media_path = forgedPath;

    const workerClientC = simC.createClientForUser(USER_A_ID);
    const resC = await processProjectRenderJob(workerClientC, USER_A_ID, {
      jobId: JOB_B_ID,
    });
    expect(resC.claimed).toBe(false);
    expect(resC.status).toBe("failed");
    expect(simC.state.renderJobs.get(JOB_B_ID)!.status).toBe("failed");
  });

  it("6. Concurrent worker claim safety: two workers racing on the same queued job result in at most one claim", async () => {
    const sim = setupStandardMultiUserState();
    const worker1Client = sim.createClientForUser(USER_A_ID);
    const worker2Client = sim.createClientForUser(WORKER_2_ID);

    const [res1, res2] = await Promise.all([
      processProjectRenderJob(worker1Client, USER_A_ID, { jobId: JOB_B_ID }),
      processProjectRenderJob(worker2Client, WORKER_2_ID, { jobId: JOB_B_ID }),
    ]);

    const claimedResults = [res1, res2].filter((r) => r.claimed);
    const skippedResults = [res1, res2].filter((r) => !r.claimed);

    expect(claimedResults).toHaveLength(1);
    expect(skippedResults).toHaveLength(1);
    expect(claimedResults[0]!.status).toBe("completed");
    expect(skippedResults[0]!.status).toBe("skipped");

    const finalJob = sim.state.renderJobs.get(JOB_B_ID)!;
    expect(finalJob.attempt_count).toBe(1);
    expect(finalJob.status).toBe("completed");
  }, 45_000);

  it("7. Mid-render cancellation or consent withdrawal aborts completion and leaves no exposed output media", async () => {
    // Subcase 7A: Contributor C withdraws consent right before completion commit
    const simWithdraw = setupStandardMultiUserState();
    const workerClient1 = simWithdraw.createClientForUser(USER_A_ID);

    const resWithdraw = await processProjectRenderJob(workerClient1, USER_A_ID, {
      jobId: JOB_B_ID,
      onBeforeCommit: async () => {
        simWithdraw.withdrawContributionConsent(CONTRIB_B2_ID, USER_C_ID);
      },
    });

    expect(resWithdraw.claimed).toBe(true);
    expect(resWithdraw.status).toBe("failed");
    expect(resWithdraw.outputMediaPath).toBeNull();
    expect(resWithdraw.failureReason).toMatch(/consent|withdrawn/i);

    const jobAfterWithdraw = simWithdraw.state.renderJobs.get(JOB_B_ID)!;
    const projAfterWithdraw = simWithdraw.state.projects.get(PROJECT_B_ID)!;
    expect(jobAfterWithdraw.status).toBe("failed");
    expect(jobAfterWithdraw.output_media_path).toBeNull();
    expect(projAfterWithdraw.output_media_path).toBeNull();

    // Ensure no stitched output file remains in storageObjects
    const stitchedKeysAfterWithdraw = Array.from(
      simWithdraw.state.storageObjects.keys()
    ).filter((k) => k.includes("/stitched-"));
    expect(stitchedKeysAfterWithdraw).toHaveLength(0);

    // Subcase 7B: Project Owner B cancels project during rendering
    const simCancel = setupStandardMultiUserState();
    const workerClient2 = simCancel.createClientForUser(USER_A_ID);

    const resCancel = await processProjectRenderJob(workerClient2, USER_A_ID, {
      jobId: JOB_B_ID,
      onBeforeCommit: async () => {
        simCancel.cancelProject(PROJECT_B_ID, USER_B_ID);
      },
    });

    expect(resCancel.claimed).toBe(true);
    expect(resCancel.status).toBe("failed");
    expect(resCancel.outputMediaPath).toBeNull();
    expect(resCancel.failureReason).toMatch(/cancelled|consent/i);
    expect(simCancel.state.projects.get(PROJECT_B_ID)!.output_media_path).toBeNull();
  }, 45_000);

  it("8. Unauthorized storage upload path rejection: worker cannot upload to arbitrary user folders, wrong job IDs, or non-canonical filenames", async () => {
    const sim = setupStandardMultiUserState();
    const workerClient = sim.createClientForUser(USER_A_ID);

    // 1. Before claiming any job, worker cannot upload even to a canonical-looking path
    const preClaimPath = buildCanonicalRenderOutputPath(
      USER_B_ID,
      PROJECT_B_ID,
      JOB_B_ID,
      "12345678"
    );
    const preClaimUpload = await workerClient.storage
      .from("media")
      .upload(preClaimPath, Buffer.from("fake"));
    expect(preClaimUpload.error).toBeTruthy();

    // 2. Dedicated worker (allow_user_uploads = false) cannot upload arbitrary files under its own folder
    const ownFolderUpload = await workerClient.storage
      .from("media")
      .upload(`${USER_A_ID}/arbitrary-post.mp4`, Buffer.from("fake"));
    expect(ownFolderUpload.error).toBeTruthy();

    // 3. Claim Job B so worker has an active processing job for Project B
    const claimRes = await workerClient.rpc("claim_project_render_job", {
      p_job_id: JOB_B_ID,
    });
    expect(claimRes.error).toBeNull();
    expect(claimRes.data).toHaveLength(1);

    // 4. While processing Job B, worker still cannot upload to:
    // - Arbitrary file in User B's folder
    const arbitraryUserBUpload = await workerClient.storage
      .from("media")
      .upload(`${USER_B_ID}/avatar-overwrite.mp4`, Buffer.from("fake"));
    expect(arbitraryUserBUpload.error).toBeTruthy();

    // - Canonical-looking path for Project C / Job C
    const wrongProjectPath = buildCanonicalRenderOutputPath(
      USER_C_ID,
      PROJECT_C_ID,
      JOB_C_ID,
      "12345678"
    );
    const wrongProjectUpload = await workerClient.storage
      .from("media")
      .upload(wrongProjectPath, Buffer.from("fake"));
    expect(wrongProjectUpload.error).toBeTruthy();

    // - Path traversal attempt
    expect(
      isCanonicalRenderOutputPath(
        `${USER_B_ID}/../${USER_C_ID}/stitched-${PROJECT_B_ID}-${JOB_B_ID}-12345678.mp4`,
        USER_B_ID,
        PROJECT_B_ID,
        JOB_B_ID
      )
    ).toBe(false);

    // 5. Canonical path for the active claimed Job B succeeds
    const validUpload = await workerClient.storage
      .from("media")
      .upload(preClaimPath, clipRedBytes);
    expect(validUpload.error).toBeNull();
  });

  it("9. Editor retry preserved: project owner/editor can retry a failed render job, while dedicated non-editor worker cannot retry", async () => {
    const sim = setupStandardMultiUserState();
    const workerClient = sim.createClientForUser(USER_A_ID);
    const ownerBClient = sim.createClientForUser(USER_B_ID);

    // Claim and then mark Job B as failed
    await workerClient.rpc("claim_project_render_job", { p_job_id: JOB_B_ID });
    const failRes = await workerClient
      .from("project_render_jobs")
      .update({
        status: "failed",
        failure_reason: "Simulated transient storage timeout.",
      })
      .eq("id", JOB_B_ID)
      .select()
      .maybeSingle();

    expect(failRes.error).toBeNull();
    expect(sim.state.renderJobs.get(JOB_B_ID)!.status).toBe("failed");
    expect(sim.state.projects.get(PROJECT_B_ID)!.status).toBe("locked");

    // Dedicated worker (non-editor) CANNOT retry a failed job (`failed -> queued`)
    const workerRetryRes = await workerClient
      .from("project_render_jobs")
      .update({
        status: "queued",
      })
      .eq("id", JOB_B_ID)
      .select()
      .maybeSingle();
    expect(workerRetryRes.error).toBeTruthy();
    expect(workerRetryRes.error?.message).toMatch(/Only project editors can retry/i);

    // Project Owner (User B) CAN retry the failed job (`failed -> queued`)
    const ownerRetryRes = await ownerBClient
      .from("project_render_jobs")
      .update({
        status: "queued",
      })
      .eq("id", JOB_B_ID)
      .select()
      .maybeSingle();
    expect(ownerRetryRes.error).toBeNull();
    expect(ownerRetryRes.data?.status).toBe("queued");
    expect(ownerRetryRes.data?.claimed_by).toBeNull();
    expect(sim.state.projects.get(PROJECT_B_ID)!.status).toBe("rendering");

    // And the worker can now claim and complete the retried job!
    const secondRun = await processProjectRenderJob(workerClient, USER_A_ID, {
      jobId: JOB_B_ID,
    });
    expect(secondRun.claimed).toBe(true);
    expect(secondRun.status).toBe("completed");
    expect(sim.state.renderJobs.get(JOB_B_ID)!.attempt_count).toBe(2);
  }, 45_000);

  it("10. Storage media read authorization (Finding 1): enforces post status/visibility/followers, private project contributions/outputs, block/restriction/deactivation rules, and dedicated worker manifest-only isolation", async () => {
    const sim = setupStandardMultiUserState();

    // Create additional test users:
    // - USER_E_ID: Pending follower of User B
    // - USER_F_ID: Accepted follower of User B
    // - USER_G_ID: Blocked by User B
    // - USER_H_ID: Restricted viewer account
    // - USER_I_ID: Deactivated viewer account
    const USER_E_ID = "10000000-0000-4000-8000-0000000000e5";
    const USER_F_ID = "10000000-0000-4000-8000-0000000000f6";
    const USER_G_ID = "10000000-0000-4000-8000-0000000000a7";
    const USER_H_ID = "10000000-0000-4000-8000-0000000000b8";
    const USER_I_ID = "10000000-0000-4000-8000-0000000000c9";

    for (const [uid, restricted, status] of [
      [USER_E_ID, false, "active"],
      [USER_F_ID, false, "active"],
      [USER_G_ID, false, "active"],
      [USER_H_ID, true, "active"],
      [USER_I_ID, false, "deactivated"],
    ] as const) {
      sim.state.profiles.set(uid, {
        id: uid,
        is_private: false,
        account_status: status,
        is_restricted: restricted,
      });
    }

    // Set up follow relationships with User B
    sim.state.follows.push(
      {
        follower_id: USER_E_ID,
        following_id: USER_B_ID,
        status: "pending",
      },
      {
        follower_id: USER_F_ID,
        following_id: USER_B_ID,
        status: "accepted",
      },
      {
        follower_id: USER_G_ID,
        following_id: USER_B_ID,
        status: "accepted",
      }
    );

    // User B blocks User G
    sim.state.blocks.push({
      blocker_id: USER_B_ID,
      blocked_id: USER_G_ID,
    });

    // 1. Followers-only published post by User B
    const followersOnlyMediaPath = `${USER_B_ID}/followers-only-post.mp4`;
    sim.state.storageObjects.set(followersOnlyMediaPath, clipRedBytes);
    sim.state.posts.set("40000000-0000-4000-8000-000000000f01", {
      id: "40000000-0000-4000-8000-000000000f01",
      creator_id: USER_B_ID,
      visibility: "followers",
      status: "published",
      is_restricted: false,
      media_url: followersOnlyMediaPath,
    });

    // 2. Public draft post by User B (`visibility = 'public'`, `status = 'draft'`)
    const draftPublicMediaPath = `${USER_B_ID}/draft-public-post.mp4`;
    sim.state.storageObjects.set(draftPublicMediaPath, clipRedBytes);
    sim.state.posts.set("40000000-0000-4000-8000-000000000f02", {
      id: "40000000-0000-4000-8000-000000000f02",
      creator_id: USER_B_ID,
      visibility: "public",
      status: "draft",
      is_restricted: false,
      media_url: draftPublicMediaPath,
    });

    // 3. Public removed post (`status = 'removed'`) and restricted post (`is_restricted = true`)
    const removedPublicMediaPath = `${USER_B_ID}/removed-public-post.mp4`;
    const restrictedPublicMediaPath = `${USER_B_ID}/restricted-public-post.mp4`;
    sim.state.storageObjects.set(removedPublicMediaPath, clipRedBytes);
    sim.state.storageObjects.set(restrictedPublicMediaPath, clipRedBytes);
    sim.state.posts.set("40000000-0000-4000-8000-000000000f03", {
      id: "40000000-0000-4000-8000-000000000f03",
      creator_id: USER_B_ID,
      visibility: "public",
      status: "removed",
      is_restricted: false,
      media_url: removedPublicMediaPath,
    });
    sim.state.posts.set("40000000-0000-4000-8000-000000000f04", {
      id: "40000000-0000-4000-8000-000000000f04",
      creator_id: USER_B_ID,
      visibility: "public",
      status: "published",
      is_restricted: true,
      media_url: restrictedPublicMediaPath,
    });

    // 4. Public published post by User B (`visibility = 'public'`, `status = 'published'`)
    const publicPublishedMediaPath = `${USER_B_ID}/public-published-post.mp4`;
    sim.state.storageObjects.set(publicPublishedMediaPath, clipRedBytes);
    sim.state.posts.set("40000000-0000-4000-8000-000000000f05", {
      id: "40000000-0000-4000-8000-000000000f05",
      creator_id: USER_B_ID,
      visibility: "public",
      status: "published",
      is_restricted: false,
      media_url: publicPublishedMediaPath,
    });

    // 5. Public completed collaborative project by User B
    const PUBLIC_PROJECT_ID = "20000000-0000-4000-8000-000000000b99";
    const publicCompletedOutputPath = `${USER_B_ID}/stitched-${PUBLIC_PROJECT_ID}-60000000-0000-4000-8000-000000000b99-abcdef01.mp4`;
    const publicApprovedContribPath = `${USER_C_ID}/public-proj-approved-clip.mp4`;
    const publicPendingContribPath = `${USER_C_ID}/public-proj-pending-clip.mp4`;
    sim.state.storageObjects.set(publicCompletedOutputPath, clipRedBytes);
    sim.state.storageObjects.set(publicApprovedContribPath, clipBlueBytes);
    sim.state.storageObjects.set(publicPendingContribPath, clipBlueBytes);

    sim.state.projects.set(PUBLIC_PROJECT_ID, {
      id: PUBLIC_PROJECT_ID,
      creator_id: USER_B_ID,
      community_id: null,
      title: "User B Public Completed Project",
      status: "completed",
      visibility: "public",
      participation_mode: "open",
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      output_media_path: publicCompletedOutputPath,
      output_provenance: null,
    });
    sim.state.participants.push(
      {
        project_id: PUBLIC_PROJECT_ID,
        user_id: USER_B_ID,
        role: "owner",
        status: "active",
      },
      {
        project_id: PUBLIC_PROJECT_ID,
        user_id: USER_C_ID,
        role: "contributor",
        status: "active",
      }
    );
    sim.state.contributions.set("50000000-0000-4000-8000-000000000b91", {
      id: "50000000-0000-4000-8000-000000000b91",
      project_id: PUBLIC_PROJECT_ID,
      contributor_id: USER_C_ID,
      media_path: publicApprovedContribPath,
      media_type: "short_video",
      review_status: "approved",
      consent_granted: true,
      consent_granted_at: "2026-10-10T00:00:00.000Z",
      consent_withdrawn_at: null,
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      sequence_order: 1,
      ai_disclosure_status: "no_ai_declared",
    });
    sim.state.contributions.set("50000000-0000-4000-8000-000000000b92", {
      id: "50000000-0000-4000-8000-000000000b92",
      project_id: PUBLIC_PROJECT_ID,
      contributor_id: USER_C_ID,
      media_path: publicPendingContribPath,
      media_type: "short_video",
      review_status: "pending",
      consent_granted: true,
      consent_granted_at: "2026-10-10T00:00:00.000Z",
      consent_withdrawn_at: null,
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      sequence_order: 2,
      ai_disclosure_status: "no_ai_declared",
    });

    // Clients for each persona
    const nonFollowerD = sim.createClientForUser(USER_D_ID);
    const pendingFollowerE = sim.createClientForUser(USER_E_ID);
    const acceptedFollowerF = sim.createClientForUser(USER_F_ID);
    const blockedViewerG = sim.createClientForUser(USER_G_ID);
    const restrictedViewerH = sim.createClientForUser(USER_H_ID);
    const deactivatedViewerI = sim.createClientForUser(USER_I_ID);
    const creatorB = sim.createClientForUser(USER_B_ID);
    const contributorC = sim.createClientForUser(USER_C_ID);
    const workerA = sim.createClientForUser(USER_A_ID);

    // (a) Followers-only post media:
    // Denied to non-follower (User D), pending follower (User E), blocked follower (User G), and dedicated worker (User A)
    expect((await nonFollowerD.storage.from("media").createSignedUrl(followersOnlyMediaPath, 60)).error).toBeTruthy();
    expect((await pendingFollowerE.storage.from("media").createSignedUrl(followersOnlyMediaPath, 60)).error).toBeTruthy();
    expect((await blockedViewerG.storage.from("media").createSignedUrl(followersOnlyMediaPath, 60)).error).toBeTruthy();
    expect((await workerA.storage.from("media").createSignedUrl(followersOnlyMediaPath, 60)).error).toBeTruthy();
    // Allowed to accepted follower (User F) and creator (User B)
    expect((await acceptedFollowerF.storage.from("media").createSignedUrl(followersOnlyMediaPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await creatorB.storage.from("media").createSignedUrl(followersOnlyMediaPath, 60)).data?.signedUrl).toBeTruthy();

    // (b) Draft, removed, and restricted post media:
    // Denied to non-creator even when visibility = 'public' and viewer is an accepted follower
    for (const nonViewablePath of [
      draftPublicMediaPath,
      removedPublicMediaPath,
      restrictedPublicMediaPath,
    ]) {
      expect((await nonFollowerD.storage.from("media").createSignedUrl(nonViewablePath, 60)).error).toBeTruthy();
      expect((await acceptedFollowerF.storage.from("media").createSignedUrl(nonViewablePath, 60)).error).toBeTruthy();
      expect((await workerA.storage.from("media").createSignedUrl(nonViewablePath, 60)).error).toBeTruthy();
      // Creator B owns the storage folder so creator B retains folder-owner access
      expect((await creatorB.storage.from("media").createSignedUrl(nonViewablePath, 60)).data?.signedUrl).toBeTruthy();
    }

    // (c) Private collaborative project contribution media (even with consent_granted = true and review_status = 'approved'):
    const privateContribClipPath = `${USER_C_ID}/clip-b2-blue.mp4`;
    // Denied to unrelated users (User D, User E, User F)
    expect((await nonFollowerD.storage.from("media").createSignedUrl(privateContribClipPath, 60)).error).toBeTruthy();
    expect((await acceptedFollowerF.storage.from("media").createSignedUrl(privateContribClipPath, 60)).error).toBeTruthy();
    // Allowed to project owner/participant (User B) and clip contributor (User C)
    expect((await creatorB.storage.from("media").createSignedUrl(privateContribClipPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await contributorC.storage.from("media").createSignedUrl(privateContribClipPath, 60)).data?.signedUrl).toBeTruthy();

    // Unapproved (`review_status = 'pending'`) contribution on a PUBLIC project:
    // Denied to non-participants (User D, User F), allowed to active project participant (User B) and contributor (User C)
    expect((await nonFollowerD.storage.from("media").createSignedUrl(publicPendingContribPath, 60)).error).toBeTruthy();
    expect((await acceptedFollowerF.storage.from("media").createSignedUrl(publicPendingContribPath, 60)).error).toBeTruthy();
    expect((await creatorB.storage.from("media").createSignedUrl(publicPendingContribPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await contributorC.storage.from("media").createSignedUrl(publicPendingContribPath, 60)).data?.signedUrl).toBeTruthy();
    // Approved contribution on a PUBLIC project is readable by eligible non-blocked viewers (User D, User F)
    expect((await nonFollowerD.storage.from("media").createSignedUrl(publicApprovedContribPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await acceptedFollowerF.storage.from("media").createSignedUrl(publicApprovedContribPath, 60)).data?.signedUrl).toBeTruthy();

    // (d) Blocked, restricted, or deactivated viewers are denied access even to public published posts and public completed projects:
    for (const publicPath of [
      publicPublishedMediaPath,
      publicCompletedOutputPath,
      publicApprovedContribPath,
    ]) {
      expect((await blockedViewerG.storage.from("media").createSignedUrl(publicPath, 60)).error).toBeTruthy();
      expect((await restrictedViewerH.storage.from("media").createSignedUrl(publicPath, 60)).error).toBeTruthy();
      expect((await deactivatedViewerI.storage.from("media").createSignedUrl(publicPath, 60)).error).toBeTruthy();
    }

    // (e) Eligible regular viewers CAN read public published post media and public completed project media:
    expect((await nonFollowerD.storage.from("media").createSignedUrl(publicPublishedMediaPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await acceptedFollowerF.storage.from("media").createSignedUrl(publicPublishedMediaPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await nonFollowerD.storage.from("media").createSignedUrl(publicCompletedOutputPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await acceptedFollowerF.storage.from("media").createSignedUrl(publicCompletedOutputPath, 60)).data?.signedUrl).toBeTruthy();

    // (f) Dedicated render worker (User A) cannot read ANY general user media (even public published posts or public completed project outputs!)
    expect((await workerA.storage.from("media").createSignedUrl(publicPublishedMediaPath, 60)).error).toBeTruthy();
    expect((await workerA.storage.from("media").createSignedUrl(publicCompletedOutputPath, 60)).error).toBeTruthy();
    expect((await workerA.storage.from("media").createSignedUrl(publicApprovedContribPath, 60)).error).toBeTruthy();

    // Before claiming Job B, dedicated worker also cannot read Job B's manifest clips
    expect((await workerA.storage.from("media").createSignedUrl(privateContribClipPath, 60)).error).toBeTruthy();

    // Claim Job B as dedicated worker User A: now ONLY Job B's active manifest clips become readable to User A
    const claimRes = await workerA.rpc("claim_project_render_job", { p_job_id: JOB_B_ID });
    expect(claimRes.error).toBeNull();
    expect((await workerA.storage.from("media").createSignedUrl(privateContribClipPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await workerA.storage.from("media").createSignedUrl(`${USER_B_ID}/clip-b1-red.mp4`, 60)).data?.signedUrl).toBeTruthy();

    // Even during an active claim, dedicated worker still cannot read public post media, public project outputs, or unapproved clips outside its manifest
    expect((await workerA.storage.from("media").createSignedUrl(publicPublishedMediaPath, 60)).error).toBeTruthy();
    expect((await workerA.storage.from("media").createSignedUrl(publicCompletedOutputPath, 60)).error).toBeTruthy();
    expect((await workerA.storage.from("media").createSignedUrl(publicPendingContribPath, 60)).error).toBeTruthy();

    // Finish rendering Job B and verify that completed private project output is accessible ONLY to Project B viewers (User B, User C) and NOT to User D, User F, or Worker A
    const renderRes = await processProjectRenderJob(workerA, USER_A_ID, {
      jobId: JOB_B_ID,
    });
    // Note: Job B was already claimed above, so complete it or run on fresh state to verify private completed output access
    expect(renderRes.status).toBe("skipped"); // already 'processing'

    // Complete Job B directly as the claiming worker
    const privateOutputPath = buildCanonicalRenderOutputPath(
      USER_B_ID,
      PROJECT_B_ID,
      JOB_B_ID,
      "99887766"
    );
    expect((await workerA.storage.from("media").upload(privateOutputPath, clipRedBytes)).error).toBeNull();
    const completeUpdate = await workerA
      .from("project_render_jobs")
      .update({
        status: "completed",
        output_media_path: privateOutputPath,
        output_provenance: {
          schema_version: "1.0",
          project_id: PROJECT_B_ID,
          render_job_id: JOB_B_ID,
          rendered_at: new Date().toISOString(),
          consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
          ai_disclosure_status: "no_ai_declared",
          ai_disclosure_summary: "No AI declared",
          clip_count: 2,
          clips: [],
        },
      })
      .eq("id", JOB_B_ID)
      .select()
      .maybeSingle();
    expect(completeUpdate.error).toBeNull();

    // Private completed project output:
    // Denied to unrelated users (User D, User F) and dedicated worker (User A)
    expect((await nonFollowerD.storage.from("media").createSignedUrl(privateOutputPath, 60)).error).toBeTruthy();
    expect((await acceptedFollowerF.storage.from("media").createSignedUrl(privateOutputPath, 60)).error).toBeTruthy();
    expect((await workerA.storage.from("media").createSignedUrl(privateOutputPath, 60)).error).toBeTruthy();
    // Allowed to private project participants (User B, User C)
    expect((await creatorB.storage.from("media").createSignedUrl(privateOutputPath, 60)).data?.signedUrl).toBeTruthy();
    expect((await contributorC.storage.from("media").createSignedUrl(privateOutputPath, 60)).data?.signedUrl).toBeTruthy();
  });

  it("11. Helper RPC caller-identity and execution restrictions (Finding 2): authenticated users cannot enumerate worker identities or probe private project/media state for other users", async () => {
    const sim = setupStandardMultiUserState();
    const attackerD = sim.createClientForUser(USER_D_ID);
    const workerA = sim.createClientForUser(USER_A_ID);
    const ownerB = sim.createClientForUser(USER_B_ID);

    // Have worker A claim Job B so worker A has active processing state
    await workerA.rpc("claim_project_render_job", { p_job_id: JOB_B_ID });

    // 1. Attacker D cannot probe whether User A or Worker 2 is an authorized or dedicated render worker
    expect((await attackerD.rpc("is_authorized_render_worker", { u_id: USER_A_ID })).data).toBe(false);
    expect((await attackerD.rpc("is_authorized_render_worker", { u_id: WORKER_2_ID })).data).toBe(false);
    expect((await attackerD.rpc("is_dedicated_render_worker_only", { u_id: USER_A_ID })).data).toBe(false);

    // Worker A checking its own identity returns true
    expect((await workerA.rpc("is_authorized_render_worker", { u_id: USER_A_ID })).data).toBe(true);
    expect((await workerA.rpc("is_dedicated_render_worker_only", { u_id: USER_A_ID })).data).toBe(true);
    // Worker A checking Worker 2's identity returns false (cannot enumerate peers)
    expect((await workerA.rpc("is_authorized_render_worker", { u_id: WORKER_2_ID })).data).toBe(false);

    // 2. Attacker D cannot probe whether Worker A is processing Project B, or whether Contribution B2 / media clip is in Worker A's manifest
    expect(
      (
        await attackerD.rpc("is_worker_processing_project", {
          p_project_id: PROJECT_B_ID,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(false);
    expect(
      (
        await attackerD.rpc("is_contribution_in_active_worker_manifest", {
          p_project_id: PROJECT_B_ID,
          p_contribution_id: CONTRIB_B2_ID,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(false);
    expect(
      (
        await attackerD.rpc("is_media_in_active_worker_manifest", {
          p_media_path: `${USER_C_ID}/clip-b2-blue.mp4`,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(false);

    // Worker A checking its own active manifest returns true
    expect(
      (
        await workerA.rpc("is_worker_processing_project", {
          p_project_id: PROJECT_B_ID,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(true);
    expect(
      (
        await workerA.rpc("is_contribution_in_active_worker_manifest", {
          p_project_id: PROJECT_B_ID,
          p_contribution_id: CONTRIB_B2_ID,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(true);
    expect(
      (
        await workerA.rpc("is_media_in_active_worker_manifest", {
          p_media_path: `${USER_C_ID}/clip-b2-blue.mp4`,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(true);

    // 3. Attacker D cannot probe project view/editor/participant helpers by supplying User B's or User C's UUID
    expect(
      (await attackerD.rpc("can_view_project", { p_id: PROJECT_B_ID, u_id: USER_B_ID })).data
    ).toBe(false);
    expect(
      (await attackerD.rpc("is_project_editor", { p_id: PROJECT_B_ID, u_id: USER_B_ID })).data
    ).toBe(false);
    expect(
      (
        await attackerD.rpc("is_project_active_participant", {
          p_id: PROJECT_B_ID,
          u_id: USER_C_ID,
        })
      ).data
    ).toBe(false);

    // Owner B can check their own permissions (and as project editor can check participant status for their project)
    expect(
      (await ownerB.rpc("can_view_project", { p_id: PROJECT_B_ID, u_id: USER_B_ID })).data
    ).toBe(true);
    expect(
      (await ownerB.rpc("is_project_editor", { p_id: PROJECT_B_ID, u_id: USER_B_ID })).data
    ).toBe(true);
    expect(
      (
        await ownerB.rpc("is_project_active_participant", {
          p_id: PROJECT_B_ID,
          u_id: USER_C_ID,
        })
      ).data
    ).toBe(true);

    // 4. Attacker D cannot probe upload/cleanup helper RPCs for User B or Worker A
    const candidateOutputPath = buildCanonicalRenderOutputPath(
      USER_B_ID,
      PROJECT_B_ID,
      JOB_B_ID,
      "12345678"
    );
    expect(
      (
        await attackerD.rpc("can_upload_render_output_object", {
          p_object_name: candidateOutputPath,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(false);
    expect(
      (
        await attackerD.rpc("can_cleanup_render_output_object", {
          p_object_name: candidateOutputPath,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(false);

    // Worker A checking its own upload/cleanup eligibility for its claimed Job B returns true
    expect(
      (
        await workerA.rpc("can_upload_render_output_object", {
          p_object_name: candidateOutputPath,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(true);
    expect(
      (
        await workerA.rpc("can_cleanup_render_output_object", {
          p_object_name: candidateOutputPath,
          p_worker_id: USER_A_ID,
        })
      ).data
    ).toBe(true);

    // 5. Internal pure helper `is_canonical_render_output_path` is revoked from authenticated/anon clients
    const untypedRpc = attackerD.rpc as unknown as (
      fnName: string,
      args?: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const canonicalRpcAttempt = await untypedRpc("is_canonical_render_output_path", {
      p_object_name: candidateOutputPath,
      p_project_creator_id: USER_B_ID,
      p_project_id: PROJECT_B_ID,
      p_job_id: JOB_B_ID,
    });
    expect(canonicalRpcAttempt.error).toBeTruthy();
    expect(canonicalRpcAttempt.error?.message).toMatch(/permission denied/i);

    // 6. Internal participant helper `is_active_project_participant_internal` is revoked from authenticated/anon clients
    const internalParticipantRpcAttempt = await untypedRpc(
      "is_active_project_participant_internal",
      {
        p_id: PROJECT_B_ID,
        u_id: USER_C_ID,
      }
    );
    expect(internalParticipantRpcAttempt.error).toBeTruthy();
    expect(internalParticipantRpcAttempt.error?.message).toMatch(/permission denied/i);
  });

  it("12. Worker helper identity separation: dedicated non-participant worker succeeds via internal participant validation while client-callable helper rejects cross-user/worker checks, and deactivated/removed/tampered contributors are rejected", async () => {
    const sim = setupStandardMultiUserState();
    const workerA = sim.createClientForUser(USER_A_ID);
    const anonClient = sim.createClientForUser("");

    // (a) Prove the exact identity conflict on client-callable `is_project_active_participant`:
    // When `callerId` (`auth.uid()`) is the dedicated non-participant worker (`USER_A_ID`),
    // `is_project_active_participant(PROJECT_B_ID, USER_B_ID)` and `is_project_active_participant(PROJECT_B_ID, USER_C_ID)`
    // return `false` because `USER_A_ID` is a dedicated worker and neither `USER_B_ID`/`USER_C_ID` nor an editor.
    expect(sim.isProjectActiveParticipant(PROJECT_B_ID, USER_B_ID, USER_A_ID)).toBe(false);
    expect(sim.isProjectActiveParticipant(PROJECT_B_ID, USER_C_ID, USER_A_ID)).toBe(false);
    expect(
      (
        await workerA.rpc("is_project_active_participant", {
          p_id: PROJECT_B_ID,
          u_id: USER_B_ID,
        })
      ).data
    ).toBe(false);
    expect(
      (
        await workerA.rpc("is_project_active_participant", {
          p_id: PROJECT_B_ID,
          u_id: USER_C_ID,
        })
      ).data
    ).toBe(false);

    // Conversely, the internal helper `is_active_project_participant_internal` (revoked from client RPC)
    // accurately validates that `USER_B_ID` (owner) and `USER_C_ID` (active contributor) are active participants,
    // while `USER_A_ID` (worker) and `USER_D_ID` (unrelated user) are not.
    expect(sim.isActiveProjectParticipantInternal(PROJECT_B_ID, USER_B_ID)).toBe(true);
    expect(sim.isActiveProjectParticipantInternal(PROJECT_B_ID, USER_C_ID)).toBe(true);
    expect(sim.isActiveProjectParticipantInternal(PROJECT_B_ID, USER_A_ID)).toBe(false);
    expect(sim.isActiveProjectParticipantInternal(PROJECT_B_ID, USER_D_ID)).toBe(false);

    // (b) Trace non-participant worker (`USER_A_ID`) end-to-end through:
    // `claim_project_render_job` -> `handle_project_render_job_update` -> `validate_render_job_manifest_integrity`
    // -> `is_media_in_active_worker_manifest` -> storage SELECT -> FFmpeg render -> `can_upload_render_output_object` -> completion
    const validRun = await processProjectRenderJob(workerA, USER_A_ID, {
      jobId: JOB_B_ID,
    });
    expect(validRun.claimed).toBe(true);
    expect(validRun.status).toBe("completed");
    expect(validRun.outputMediaPath).toBeTruthy();

    // (c) Verify rejection when contributor C is removed from `project_participants` (`status = 'removed'`)
    const simRemoved = setupStandardMultiUserState();
    const participantC = simRemoved.state.participants.find(
      (p) => p.project_id === PROJECT_B_ID && p.user_id === USER_C_ID
    )!;
    participantC.status = "removed";
    expect(simRemoved.isActiveProjectParticipantInternal(PROJECT_B_ID, USER_C_ID)).toBe(
      false
    );
    const workerRemoved = simRemoved.createClientForUser(USER_A_ID);
    const resRemoved = await processProjectRenderJob(workerRemoved, USER_A_ID, {
      jobId: JOB_B_ID,
    });
    expect(resRemoved.claimed).toBe(false);
    expect(resRemoved.status).toBe("failed");
    expect(simRemoved.state.renderJobs.get(JOB_B_ID)!.status).toBe("failed");

    // (d) Verify rejection when contributor C's account is deactivated (`account_status = 'deactivated'`)
    const simDeactivated = setupStandardMultiUserState();
    simDeactivated.state.profiles.get(USER_C_ID)!.account_status = "deactivated";
    expect(
      simDeactivated.isActiveProjectParticipantInternal(PROJECT_B_ID, USER_C_ID)
    ).toBe(false);
    const workerDeactivated = simDeactivated.createClientForUser(USER_A_ID);
    const resDeactivated = await processProjectRenderJob(
      workerDeactivated,
      USER_A_ID,
      { jobId: JOB_B_ID }
    );
    expect(resDeactivated.claimed).toBe(false);
    expect(resDeactivated.status).toBe("failed");
    expect(simDeactivated.state.renderJobs.get(JOB_B_ID)!.status).toBe("failed");

    // (e) Verify rejection when manifest `sequence_order` is tampered with relative to `project_contributions`
    const simTamperedSeq = setupStandardMultiUserState();
    simTamperedSeq.state.contributions.get(CONTRIB_B2_ID)!.sequence_order = 5;
    const workerTamperedSeq = simTamperedSeq.createClientForUser(USER_A_ID);
    const resTamperedSeq = await processProjectRenderJob(
      workerTamperedSeq,
      USER_A_ID,
      { jobId: JOB_B_ID }
    );
    expect(resTamperedSeq.claimed).toBe(false);
    expect(resTamperedSeq.status).toBe("failed");
    expect(simTamperedSeq.state.renderJobs.get(JOB_B_ID)!.status).toBe("failed");

    // (f) Verify anonymous (`anon`, `auth.uid() = null`) SELECT on `collaborative_projects`
    // can view public non-draft projects via `can_view_project` without failing on `is_dedicated_render_worker_only`
    const PUBLIC_OPEN_PROJ_ID = "30000000-0000-4000-8000-000000000333";
    sim.state.projects.set(PUBLIC_OPEN_PROJ_ID, {
      id: PUBLIC_OPEN_PROJ_ID,
      creator_id: USER_B_ID,
      community_id: null,
      title: "Public Open Project",
      status: "open",
      visibility: "public",
      participation_mode: "open",
      consent_policy_version: CURRENT_CONSENT_POLICY_VERSION,
      output_media_path: null,
      output_provenance: null,
    });
    const anonPublicSelect = await anonClient
      .from("collaborative_projects")
      .select("*")
      .eq("id", PUBLIC_OPEN_PROJ_ID)
      .maybeSingle();
    expect(anonPublicSelect.error).toBeNull();
    expect(anonPublicSelect.data?.id).toBe(PUBLIC_OPEN_PROJ_ID);

    const anonPrivateSelect = await anonClient
      .from("collaborative_projects")
      .select("*")
      .eq("id", PROJECT_B_ID)
      .maybeSingle();
    expect(anonPrivateSelect.error).toBeNull();
    expect(anonPrivateSelect.data).toBeNull();
  }, 45_000);

  it("verifies forward SQL migration 20261013060000_secure_render_worker_authorization.sql security review invariants", async () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "supabase/migrations/20261013060000_secure_render_worker_authorization.sql"
    );
    const sql = await fs.readFile(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.render_workers");
    expect(sql).toContain("ALTER TABLE public.render_workers ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS claimed_by UUID");
    expect(sql).toContain("FOR UPDATE OF rj SKIP LOCKED");
    expect(sql).toContain("public.is_canonical_render_output_path");
    expect(sql).toContain("public.is_media_in_active_worker_manifest");
    expect(sql).toContain("public.can_upload_render_output_object");
    expect(sql).toContain("SET search_path = ''");
    // Ensure platform_staff is not overloaded for worker access
    expect(sql).not.toMatch(/FROM\s+public\.platform_staff/i);

    // Finding 1 invariants:
    // Storage policy must enforce posts status = 'published', visibility checks, follows status = 'accepted',
    // can_view_project on contributions and completed outputs, and dedicated worker exclusion
    expect(sql).toContain("p.status = 'published'");
    expect(sql).toContain("NOT public.is_post_restricted(p.id)");
    expect(sql).toContain("f.status = 'accepted'");
    expect(sql).toContain("public.can_view_project(pc.project_id, (SELECT auth.uid()))");
    expect(sql).toContain("public.can_view_project(cp.id, (SELECT auth.uid()))");
    expect(sql).toContain("NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))");
    expect(sql).toContain("CREATE POLICY \"posts_exclude_dedicated_render_worker\"");

    // Finding 2 invariants:
    // Helper functions enforce caller identity (`= (SELECT auth.uid())`) and revoke internal helpers from PUBLIC/anon/authenticated
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.is_canonical_render_output_path(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;"
    );
    expect(sql).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.is_canonical_render_output_path(TEXT, UUID, UUID, UUID) TO authenticated;"
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.is_active_project_participant_internal(UUID, UUID) FROM PUBLIC, anon, authenticated;"
    );
    expect(sql).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.is_active_project_participant_internal(UUID, UUID) TO authenticated;"
    );
    expect(sql).toContain(
      "public.is_active_project_participant_internal(p_project_id, pc.contributor_id)"
    );
    expect(sql).toContain(
      "public.is_active_project_participant_internal(rj.project_id, pc.contributor_id)"
    );
    expect(sql).toContain("p_worker_id = (SELECT auth.uid())");
    expect(sql).toContain("u_id = (SELECT auth.uid())");
  });
});


