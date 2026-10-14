"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  createProjectAction,
  updateProjectAction,
  getProjectsAction,
  getProjectDetailsAction,
  joinOrRequestProjectAction,
  inviteParticipantByUsernameAction,
  respondParticipationAction,
  manageParticipantAction,
  submitContributionAction,
  withdrawContributionConsentAction,
  reviewContributionAction,
  reorderContributionsAction,
  requestProjectRenderAction,
  retryProjectRenderJobAction,
  getContributionMediaUrlAction,
  getProjectOutputMediaUrlAction,
  getEligibleVideoPostsForContributionAction,
} from "@/app/actions/collaboration";
import { getUploadIntentAction } from "@/app/actions/posts";
import {
  COLLABORATIVE_CONSENT_DISCLOSURE,
  CURRENT_CONSENT_POLICY_VERSION,
  type ProjectSummaryDTO,
  type ProjectParticipantDTO,
  type ProjectContributionDTO,
  type ProjectRenderJobDTO,
  type ProjectVisibility,
  type ParticipationMode,
  type ContributionMediaType,
} from "@/lib/collaboration/types";
import {
  formatCollaborativeProvenanceSummary,
  type AiDisclosureStatus,
} from "@/lib/authenticity/types";
import { AiDisclosureSelector } from "@/components/authenticity/AiDisclosureSelector";
import { ContentAuthenticityBadge } from "@/components/authenticity/ContentAuthenticityBadge";

interface EligibleVideoPost {
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
}

export function CollaborateWorkspaceView({
  initialProjects,
}: {
  initialProjects: ProjectSummaryDTO[];
  currentUserId: string;
}) {
  const [projects, setProjects] = useState<ProjectSummaryDTO[]>(initialProjects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjects[0]?.id ?? null
  );
  const [activeProject, setActiveProject] = useState<ProjectSummaryDTO | null>(
    initialProjects[0] ?? null
  );
  const [participants, setParticipants] = useState<ProjectParticipantDTO[]>([]);
  const [contributions, setContributions] = useState<ProjectContributionDTO[]>([]);
  const [renderJobs, setRenderJobs] = useState<ProjectRenderJobDTO[]>([]);
  const [eligiblePosts, setEligiblePosts] = useState<EligibleVideoPost[]>([]);

  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Create Project Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVisibility, setNewVisibility] = useState<ProjectVisibility>("public");
  const [newParticipationMode, setNewParticipationMode] =
    useState<ParticipationMode>("open");
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Invite Participant State
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<"contributor" | "editor">(
    "contributor"
  );
  const [isInviting, setIsInviting] = useState(false);

  // Contribution Submission State
  const [sourceMode, setSourceMode] = useState<"existing_post" | "upload_new">(
    "existing_post"
  );
  const [selectedPostId, setSelectedPostId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMediaType, setUploadMediaType] =
    useState<ContributionMediaType>("short_video");
  const [clipCaption, setClipCaption] = useState("");
  const [clipAiDisclosureStatus, setClipAiDisclosureStatus] =
    useState<AiDisclosureStatus>("not_declared");
  const [clipAiDisclosureDetails, setClipAiDisclosureDetails] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [isSubmittingClip, setIsSubmittingClip] = useState(false);

  // Media Playback Preview State
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [outputVideoUrl, setOutputVideoUrl] = useState<string | null>(null);

  const refreshProjectsList = useCallback(async () => {
    const res = await getProjectsAction();
    if (res.success && res.data) {
      setProjects(res.data.projects);
    }
  }, []);

  const loadProjectDetails = useCallback(async (projectId: string) => {
    setIsLoadingDetails(true);
    setOutputVideoUrl(null);
    const res = await getProjectDetailsAction(projectId);
    if (res.success && res.data) {
      setActiveProject(res.data.project);
      setParticipants(res.data.participants);
      setContributions(res.data.contributions);
      setRenderJobs(res.data.renderJobs);
    } else {
      setFeedback({
        type: "error",
        text: res.message || "Unable to load project details.",
      });
    }
    setIsLoadingDetails(false);
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectDetails(selectedProjectId);
    }
  }, [selectedProjectId, loadProjectDetails]);

  useEffect(() => {
    getEligibleVideoPostsForContributionAction().then((res) => {
      if (res.success && res.data) {
        setEligiblePosts(res.data.posts);
        if (res.data.posts[0]) {
          setSelectedPostId(res.data.posts[0].id);
        }
      }
    });
  }, []);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmittingCreate(true);
    setFeedback(null);

    const res = await createProjectAction({
      title: newTitle,
      description: newDescription || null,
      visibility: newVisibility,
      participationMode:
        newVisibility === "private" ? "invite_only" : newParticipationMode,
      status: "open",
    });

    setIsSubmittingCreate(false);
    if (!res.success || !res.data) {
      setFeedback({
        type: "error",
        text: res.message || "Unable to create project.",
      });
      return;
    }

    setShowCreateModal(false);
    setNewTitle("");
    setNewDescription("");
    setFeedback({ type: "success", text: "Collaborative project created." });
    await refreshProjectsList();
    setSelectedProjectId(res.data.project.id);
  }

  async function handleJoinOrRequest() {
    if (!activeProject) return;
    setFeedback(null);
    const res = await joinOrRequestProjectAction(activeProject.id);
    if (!res.success) {
      setFeedback({ type: "error", text: res.message || "Action failed." });
      return;
    }
    setFeedback({ type: "success", text: res.message || "Updated." });
    await refreshProjectsList();
    await loadProjectDetails(activeProject.id);
  }

  async function handleRespondInvite(decision: "accept" | "decline") {
    if (!activeProject) return;
    setFeedback(null);
    const res = await respondParticipationAction({
      projectId: activeProject.id,
      decision,
    });
    if (!res.success) {
      setFeedback({ type: "error", text: res.message || "Action failed." });
      return;
    }
    setFeedback({ type: "success", text: res.message || "Response saved." });
    await refreshProjectsList();
    await loadProjectDetails(activeProject.id);
  }

  async function handleInviteUser(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject || !inviteUsername.trim()) return;
    setIsInviting(true);
    setFeedback(null);
    const res = await inviteParticipantByUsernameAction({
      projectId: activeProject.id,
      username: inviteUsername,
      role: inviteRole,
    });
    setIsInviting(false);
    if (!res.success) {
      setFeedback({ type: "error", text: res.message || "Invitation failed." });
      return;
    }
    setInviteUsername("");
    setFeedback({ type: "success", text: "Invitation sent." });
    await loadProjectDetails(activeProject.id);
  }

  async function handleParticipantManagement(
    participantUserId: string,
    action:
      | "approve_request"
      | "reject_request"
      | "promote_editor"
      | "demote_contributor"
      | "remove"
  ) {
    if (!activeProject) return;
    setFeedback(null);
    const res = await manageParticipantAction({
      projectId: activeProject.id,
      participantUserId,
      action,
    });
    if (!res.success) {
      setFeedback({ type: "error", text: res.message || "Action failed." });
      return;
    }
    setFeedback({ type: "success", text: res.message || "Participant updated." });
    await loadProjectDetails(activeProject.id);
  }

  async function handleSubmitContribution(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject) return;

    if (!consentChecked) {
      setFeedback({
        type: "error",
        text: "You must explicitly check the media usage consent agreement before submitting a clip.",
      });
      return;
    }

    setIsSubmittingClip(true);
    setFeedback(null);

    try {
      let mediaPath = "";
      let mediaType: ContributionMediaType = uploadMediaType;
      let mediaMetadata: {
        mimeType: string;
        sizeBytes: number;
        width?: number;
        height?: number;
        durationSeconds?: number;
      } = { mimeType: "video/mp4", sizeBytes: 1024 };
      let sourcePostId: string | null = null;

      if (sourceMode === "existing_post") {
        const chosen = eligiblePosts.find((p) => p.id === selectedPostId);
        if (!chosen) {
          setFeedback({
            type: "error",
            text: "Select an eligible published video post or switch to upload a new clip.",
          });
          setIsSubmittingClip(false);
          return;
        }
        sourcePostId = chosen.id;
        mediaPath = chosen.mediaPath;
        mediaType = chosen.contentType;
        mediaMetadata = chosen.mediaMetadata;
      } else {
        if (!selectedFile) {
          setFeedback({
            type: "error",
            text: "Select a video file (.mp4, .webm, .mov) to upload.",
          });
          setIsSubmittingClip(false);
          return;
        }

        const intentRes = await getUploadIntentAction(
          selectedFile.name,
          uploadMediaType
        );
        if (!intentRes.success || !intentRes.data) {
          setFeedback({
            type: "error",
            text: intentRes.message || "Unable to authorize clip upload.",
          });
          setIsSubmittingClip(false);
          return;
        }

        const uploadResponse = await fetch(intentRes.data.signedUploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": selectedFile.type || "video/mp4",
          },
          body: selectedFile,
        });

        if (!uploadResponse.ok) {
          setFeedback({
            type: "error",
            text: "Video file upload failed.",
          });
          setIsSubmittingClip(false);
          return;
        }

        mediaPath = intentRes.data.path;
        mediaType = uploadMediaType;
        mediaMetadata = {
          mimeType: selectedFile.type || "video/mp4",
          sizeBytes: selectedFile.size,
        };
      }

      const submitRes = await submitContributionAction({
        projectId: activeProject.id,
        sourcePostId,
        mediaPath,
        mediaType,
        mediaMetadata,
        caption: clipCaption || null,
        consentGranted: true,
        consentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION,
        aiDisclosureStatus: clipAiDisclosureStatus,
        aiDisclosureDetails: clipAiDisclosureDetails.trim() || null,
      });

      if (!submitRes.success) {
        setFeedback({
          type: "error",
          text: submitRes.message || "Failed to submit contribution.",
        });
        setIsSubmittingClip(false);
        return;
      }

      setClipCaption("");
      setClipAiDisclosureStatus("not_declared");
      setClipAiDisclosureDetails("");
      setConsentChecked(false);
      setSelectedFile(null);
      setFeedback({
        type: "success",
        text: "Clip submitted with recorded usage consent.",
      });
      await loadProjectDetails(activeProject.id);
    } finally {
      setIsSubmittingClip(false);
    }
  }

  async function handleWithdrawConsent(contributionId: string) {
    if (!activeProject) return;
    setFeedback(null);
    const res = await withdrawContributionConsentAction({
      contributionId,
      reason: "Consent withdrawn by contributor via project workspace",
    });
    if (!res.success) {
      setFeedback({
        type: "error",
        text: res.message || "Unable to withdraw consent.",
      });
      return;
    }
    setFeedback({
      type: "success",
      text: res.message || "Consent withdrawn and clip excluded.",
    });
    await refreshProjectsList();
    await loadProjectDetails(activeProject.id);
  }

  async function handleReviewContribution(
    contributionId: string,
    decision: "approved" | "rejected"
  ) {
    if (!activeProject) return;
    setFeedback(null);
    const res = await reviewContributionAction({
      contributionId,
      decision,
    });
    if (!res.success) {
      setFeedback({
        type: "error",
        text: res.message || "Unable to review contribution.",
      });
      return;
    }
    setFeedback({ type: "success", text: res.message || "Review recorded." });
    await refreshProjectsList();
    await loadProjectDetails(activeProject.id);
  }

  async function handleMoveClipOrder(
    contributionId: string,
    direction: "up" | "down"
  ) {
    if (!activeProject) return;
    const approvedClips = contributions
      .filter(
        (c) =>
          c.reviewStatus === "approved" &&
          c.consentGranted &&
          !c.consentWithdrawnAt
      )
      .sort((a, b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999));

    const idx = approvedClips.findIndex((c) => c.id === contributionId);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= approvedClips.length) return;

    const reordered = [...approvedClips];
    const temp = reordered[idx];
    reordered[idx] = reordered[swapIdx];
    reordered[swapIdx] = temp;

    const res = await reorderContributionsAction({
      projectId: activeProject.id,
      orderedContributionIds: reordered.map((c) => c.id),
    });

    if (!res.success) {
      setFeedback({
        type: "error",
        text: res.message || "Failed to reorder clips.",
      });
      return;
    }

    setFeedback({ type: "success", text: "Sequence order updated." });
    await loadProjectDetails(activeProject.id);
  }

  async function handleRequestRender() {
    if (!activeProject) return;
    setFeedback(null);
    const idempotencyKey = `render-${activeProject.id}-${activeProject.approvedClipCount}-${Date.now()}`;
    const res = await requestProjectRenderAction({
      projectId: activeProject.id,
      idempotencyKey,
      simulateExecution: false,
    });
    if (!res.success) {
      setFeedback({
        type: "error",
        text: res.message || "Unable to start render job.",
      });
      return;
    }
    setFeedback({
      type: "success",
      text: res.message || "Render job queued.",
    });
    await refreshProjectsList();
    await loadProjectDetails(activeProject.id);
  }

  async function handleRetryJob(jobId: string) {
    if (!activeProject) return;
    setFeedback(null);
    const res = await retryProjectRenderJobAction({ jobId });
    if (!res.success) {
      setFeedback({
        type: "error",
        text: res.message || "Unable to retry render job.",
      });
      return;
    }
    setFeedback({ type: "success", text: res.message || "Render job re-queued." });
    await refreshProjectsList();
    await loadProjectDetails(activeProject.id);
  }

  async function handleProjectStatusChange(
    newStatus: "open" | "locked" | "cancelled"
  ) {
    if (!activeProject) return;
    setFeedback(null);
    const res = await updateProjectAction({
      projectId: activeProject.id,
      status: newStatus,
    });
    if (!res.success) {
      setFeedback({
        type: "error",
        text: res.message || "Unable to update project status.",
      });
      return;
    }
    setFeedback({ type: "success", text: `Project status updated to ${newStatus}.` });
    await refreshProjectsList();
    await loadProjectDetails(activeProject.id);
  }

  async function handleLoadClipPreview(contributionId: string) {
    const res = await getContributionMediaUrlAction(contributionId);
    if (!res.success || !res.data) {
      setFeedback({
        type: "error",
        text: res.message || "Clip media unavailable.",
      });
      return;
    }
    setPreviewUrls((prev) => ({
      ...prev,
      [contributionId]: res.data!.signedUrl,
    }));
  }

  async function handleLoadProjectOutput() {
    if (!activeProject) return;
    const res = await getProjectOutputMediaUrlAction(activeProject.id);
    if (!res.success || !res.data) {
      setFeedback({
        type: "error",
        text: res.message || "Combined video output is not available.",
      });
      return;
    }
    setOutputVideoUrl(res.data.signedUrl);
  }

  const isEditorOrOwner =
    activeProject?.viewerStatus === "active" &&
    (activeProject.viewerRole === "owner" ||
      activeProject.viewerRole === "editor");
  const isOwner =
    activeProject?.viewerStatus === "active" &&
    activeProject.viewerRole === "owner";
  const isActiveParticipant = activeProject?.viewerStatus === "active";

  const approvedClips = contributions
    .filter(
      (c) =>
        c.reviewStatus === "approved" &&
        c.consentGranted &&
        !c.consentWithdrawnAt
    )
    .sort((a, b) => (a.sequenceOrder ?? 999) - (b.sequenceOrder ?? 999));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Collaborative Projects & Video Stitching
          </h1>
          <p className="text-sm text-[var(--foreground-muted)] mt-1">
            Co-create video stories with explicit usage consent, clip review,
            sequence ordering, and durable render jobs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-sm font-medium hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          + New Collaborative Project
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3.5 rounded-[var(--radius-sm)] border text-sm ${
            feedback.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
              : "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Project Selector */}
        <section
          aria-label="Collaborative Projects List"
          className="lg:col-span-4 space-y-3"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
            Accessible Projects ({projects.length})
          </h2>
          {projects.length === 0 ? (
            <div className="p-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--foreground-muted)]">
              No collaborative projects yet. Create one to invite contributors and
              arrange video clips.
            </div>
          ) : (
            <ul className="space-y-2.5" role="list">
              {projects.map((p) => {
                const isSelected = p.id === selectedProjectId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedProjectId(p.id)}
                      className={`w-full text-left p-4 rounded-[var(--radius-md)] border transition-colors ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--surface-muted)]"
                          : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm truncate">
                          {p.title}
                        </span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--background)]">
                          {p.status}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--foreground-muted)] mt-1 line-clamp-2">
                        {p.description || "No description provided."}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[11px] text-[var(--foreground-muted)]">
                        <span>
                          {p.visibility === "private" ? "Private" : "Public"} (
                          {p.participationMode === "invite_only"
                            ? "Invite-Only"
                            : "Open"}
                          )
                        </span>
                        <span>•</span>
                        <span>{p.participantCount} participants</span>
                        <span>•</span>
                        <span>{p.approvedClipCount} approved clips</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Right Column: Active Project Workspace */}
        <section
          aria-label="Project Workspace"
          className="lg:col-span-8 space-y-6"
        >
          {!activeProject ? (
            <div className="p-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-center text-sm text-[var(--foreground-muted)]">
              Select a collaborative project from the list or create a new one.
            </div>
          ) : isLoadingDetails ? (
            <div className="p-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--foreground-muted)]">
              Loading project workspace…
            </div>
          ) : (
            <>
              {/* Project Overview Card */}
              <div className="p-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold">{activeProject.title}</h2>
                      <span className="text-xs font-mono uppercase px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--surface-muted)]">
                        {activeProject.status}
                      </span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded border border-[var(--border)]">
                        {activeProject.visibility} /{" "}
                        {activeProject.participationMode}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--foreground-secondary)] mt-2">
                      {activeProject.description || "No project description."}
                    </p>
                    <p className="text-xs text-[var(--foreground-muted)] mt-2">
                      Created by @{activeProject.creatorUsername} • Consent Policy:{" "}
                      <code className="font-mono">
                        {activeProject.consentPolicyVersion}
                      </code>
                    </p>
                  </div>

                  {/* Participation Actions for Viewer */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!activeProject.viewerStatus &&
                      activeProject.visibility === "public" &&
                      activeProject.status === "open" && (
                        <button
                          type="button"
                          onClick={handleJoinOrRequest}
                          className="px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium"
                        >
                          {activeProject.participationMode === "open"
                            ? "Join as Contributor"
                            : "Request to Join"}
                        </button>
                      )}

                    {activeProject.viewerStatus === "invited" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRespondInvite("accept")}
                          className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-emerald-600 text-white text-xs font-medium"
                        >
                          Accept Invite
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRespondInvite("decline")}
                          className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-xs font-medium"
                        >
                          Decline
                        </button>
                      </>
                    )}

                    {isEditorOrOwner && activeProject.status === "open" && (
                      <button
                        type="button"
                        onClick={() => handleProjectStatusChange("locked")}
                        className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-xs font-medium hover:bg-[var(--surface-muted)]"
                      >
                        Lock Submissions
                      </button>
                    )}

                    {isEditorOrOwner && activeProject.status === "locked" && (
                      <button
                        type="button"
                        onClick={() => handleProjectStatusChange("open")}
                        className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-xs font-medium hover:bg-[var(--surface-muted)]"
                      >
                        Reopen Submissions
                      </button>
                    )}

                    {isOwner && activeProject.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() => handleProjectStatusChange("cancelled")}
                        className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-rose-300 text-rose-700 dark:text-rose-300 text-xs font-medium"
                      >
                        Cancel Project
                      </button>
                    )}
                  </div>
                </div>

                {/* Completed Output Playback */}
                {activeProject.status === "completed" &&
                  activeProject.hasOutputMedia && (
                    <div className="pt-4 border-t border-[var(--border)] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          Combined Video Output Ready
                        </span>
                        {!outputVideoUrl && (
                          <button
                            type="button"
                            onClick={handleLoadProjectOutput}
                            className="px-3 py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium"
                          >
                            Load Authorized Output Stream (5m TTL)
                          </button>
                        )}
                      </div>
                      {activeProject.outputProvenance && (() => {
                        const provSummary = formatCollaborativeProvenanceSummary(
                          activeProject.outputProvenance
                        );
                        return (
                          <div
                            aria-label="Collaborative Video Provenance Summary"
                            className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--foreground-secondary)] space-y-1"
                          >
                            <div className="font-semibold text-[var(--foreground)]">
                              {provSummary.headline}
                            </div>
                            <div>{provSummary.detailLine}</div>
                          </div>
                        );
                      })()}
                      {outputVideoUrl && (
                        <video
                          controls
                          src={outputVideoUrl}
                          className="w-full max-h-72 rounded-[var(--radius-sm)] bg-black"
                        />
                      )}
                    </div>
                  )}
              </div>

              {/* Submit Contribution & Explicit Consent Form */}
              {isActiveParticipant && activeProject.status === "open" && (
                <form
                  onSubmit={handleSubmitContribution}
                  aria-label="Submit Clip with Explicit Consent"
                  className="p-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
                >
                  <h3 className="text-base font-semibold">
                    Submit Video Clip & Usage Consent
                  </h3>

                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="sourceMode"
                        checked={sourceMode === "existing_post"}
                        onChange={() => setSourceMode("existing_post")}
                      />
                      <span>Select from my published video posts</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="sourceMode"
                        checked={sourceMode === "upload_new"}
                        onChange={() => setSourceMode("upload_new")}
                      />
                      <span>Upload new video clip</span>
                    </label>
                  </div>

                  {sourceMode === "existing_post" ? (
                    <div>
                      <label
                        htmlFor="existing-video-select"
                        className="block text-xs font-medium mb-1"
                      >
                        Eligible Published Video Posts
                      </label>
                      {eligiblePosts.length === 0 ? (
                        <p className="text-xs text-[var(--foreground-muted)]">
                          You have no published video posts yet. Switch to
                          &ldquo;Upload new video clip&rdquo; above.
                        </p>
                      ) : (
                        <select
                          id="existing-video-select"
                          value={selectedPostId}
                          onChange={(e) => setSelectedPostId(e.target.value)}
                          className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-sm"
                        >
                          {eligiblePosts.map((ep) => (
                            <option key={ep.id} value={ep.id}>
                              [{ep.contentType}]{" "}
                              {ep.caption
                                ? ep.caption.slice(0, 60)
                                : ep.id.slice(0, 8)}{" "}
                              ({Math.round(ep.mediaMetadata.sizeBytes / 1024)} KB)
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="upload-media-type"
                          className="block text-xs font-medium mb-1"
                        >
                          Clip Format
                        </label>
                        <select
                          id="upload-media-type"
                          value={uploadMediaType}
                          onChange={(e) =>
                            setUploadMediaType(
                              e.target.value as ContributionMediaType
                            )
                          }
                          className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-sm"
                        >
                          <option value="short_video">
                            Short Video (≤ 60s, max 100MB)
                          </option>
                          <option value="long_video">
                            Long Video (max 500MB)
                          </option>
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="clip-file-input"
                          className="block text-xs font-medium mb-1"
                        >
                          Video File (.mp4, .webm, .mov)
                        </label>
                        <input
                          id="clip-file-input"
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime"
                          onChange={(e) =>
                            setSelectedFile(e.target.files?.[0] ?? null)
                          }
                          className="w-full text-xs"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="clip-caption-input"
                      className="block text-xs font-medium mb-1"
                    >
                      Clip Note / Segment Description (Optional)
                    </label>
                    <input
                      id="clip-caption-input"
                      type="text"
                      maxLength={500}
                      value={clipCaption}
                      onChange={(e) => setClipCaption(e.target.value)}
                      placeholder="e.g. Intro segment on renewable microgrids"
                      className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-sm"
                    />
                  </div>

                  {/* AI & Material Alteration Disclosure for Submitted Clip */}
                  <AiDisclosureSelector
                    status={clipAiDisclosureStatus}
                    details={clipAiDisclosureDetails}
                    onStatusChange={setClipAiDisclosureStatus}
                    onDetailsChange={setClipAiDisclosureDetails}
                    disabled={isSubmittingClip}
                    compact
                  />

                  {/* Explicit Consent Agreement Box */}
                  <div className="p-3.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] space-y-2">
                    <div className="flex items-start gap-2.5">
                      <input
                        id="explicit-consent-checkbox"
                        type="checkbox"
                        checked={consentChecked}
                        onChange={(e) => setConsentChecked(e.target.checked)}
                        className="mt-1"
                      />
                      <label
                        htmlFor="explicit-consent-checkbox"
                        className="text-xs leading-relaxed cursor-pointer"
                      >
                        <span className="font-semibold block">
                          Explicit Collaborative Usage Consent (
                          {COLLABORATIVE_CONSENT_DISCLOSURE.version})
                        </span>
                        {COLLABORATIVE_CONSENT_DISCLOSURE.summary}
                      </label>
                    </div>
                    <p className="text-[11px] text-[var(--foreground-muted)] leading-relaxed pl-6">
                      <strong>Withdrawal Policy:</strong>{" "}
                      {COLLABORATIVE_CONSENT_DISCLOSURE.withdrawalPolicy}
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingClip || !consentChecked}
                    className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium disabled:opacity-50"
                  >
                    {isSubmittingClip
                      ? "Submitting Clip…"
                      : "Submit Clip with Explicit Consent"}
                  </button>
                </form>
              )}

              {/* Contributions & Sequence Ordering */}
              <div className="p-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold">
                      Project Contributions & Sequence ({contributions.length})
                    </h3>
                    <p className="text-xs text-[var(--foreground-muted)]">
                      Only approved clips with active consent are included in the
                      final stitched sequence ({approvedClips.length} ready).
                    </p>
                  </div>
                </div>

                {contributions.length === 0 ? (
                  <p className="text-xs text-[var(--foreground-muted)]">
                    No contributions submitted yet.
                  </p>
                ) : (
                  <ul className="space-y-3" role="list">
                    {contributions.map((c) => {
                      const isOwnClip =
                        c.contributorId === activeProject.viewerRole ||
                        participants.find(
                          (pt) =>
                            pt.userId === c.contributorId &&
                            pt.role === activeProject.viewerRole
                        );
                      return (
                        <li
                          key={c.id}
                          className="p-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {c.sequenceOrder !== null && (
                                <span
                                  aria-label={`Sequence position ${c.sequenceOrder}`}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-bold"
                                >
                                  #{c.sequenceOrder}
                                </span>
                              )}
                              <span className="text-sm font-medium">
                                @{c.contributorUsername}
                              </span>
                              <span className="text-xs font-mono px-1.5 py-0.5 rounded border border-[var(--border)]">
                                {c.mediaType}
                              </span>
                              <span
                                className={`text-[11px] font-mono uppercase px-1.5 py-0.5 rounded ${
                                  c.reviewStatus === "approved"
                                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300"
                                    : c.reviewStatus === "withdrawn" ||
                                        c.reviewStatus === "rejected"
                                      ? "bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300"
                                      : "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300"
                                }`}
                              >
                                {c.reviewStatus}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              {c.hasMedia && !previewUrls[c.id] && (
                                <button
                                  type="button"
                                  onClick={() => handleLoadClipPreview(c.id)}
                                  className="px-2.5 py-1 rounded border border-[var(--border)] text-xs hover:bg-[var(--surface-muted)]"
                                >
                                  Preview Clip
                                </button>
                              )}

                              {/* Editor Approval & Reordering Controls */}
                              {isEditorOrOwner &&
                                c.reviewStatus !== "withdrawn" &&
                                c.consentGranted &&
                                (activeProject.status === "open" ||
                                  activeProject.status === "locked") && (
                                  <>
                                    {c.reviewStatus !== "approved" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleReviewContribution(
                                            c.id,
                                            "approved"
                                          )
                                        }
                                        className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                                      >
                                        Approve
                                      </button>
                                    )}
                                    {c.reviewStatus !== "rejected" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleReviewContribution(
                                            c.id,
                                            "rejected"
                                          )
                                        }
                                        className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 dark:text-rose-300 text-xs"
                                      >
                                        Reject
                                      </button>
                                    )}
                                    {c.reviewStatus === "approved" && (
                                      <>
                                        <button
                                          type="button"
                                          aria-label="Move clip earlier in sequence"
                                          onClick={() =>
                                            handleMoveClipOrder(c.id, "up")
                                          }
                                          className="px-2 py-1 rounded border border-[var(--border)] text-xs"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          aria-label="Move clip later in sequence"
                                          onClick={() =>
                                            handleMoveClipOrder(c.id, "down")
                                          }
                                          className="px-2 py-1 rounded border border-[var(--border)] text-xs"
                                        >
                                          ↓
                                        </button>
                                      </>
                                    )}
                                  </>
                                )}

                              {/* Contributor Consent Withdrawal Control */}
                              {c.consentGranted && !c.consentWithdrawnAt && (
                                <button
                                  type="button"
                                  onClick={() => handleWithdrawConsent(c.id)}
                                  className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 dark:text-rose-300 text-xs"
                                >
                                  Withdraw Consent
                                </button>
                              )}
                              {Boolean(isOwnClip) && null}
                            </div>
                          </div>

                          {c.caption && (
                            <p className="text-xs text-[var(--foreground-secondary)]">
                              {c.caption}
                            </p>
                          )}

                          <ContentAuthenticityBadge
                            status={c.aiDisclosureStatus}
                            details={c.aiDisclosureDetails}
                            disclosedAt={c.aiDisclosedAt}
                            provenanceStatus={c.provenanceStatus}
                            compact
                          />

                          <div className="text-[11px] text-[var(--foreground-muted)] flex flex-wrap gap-3">
                            <span>
                              Consent:{" "}
                              {c.consentGranted && !c.consentWithdrawnAt
                                ? `Granted (${c.consentPolicyVersion})`
                                : "Withdrawn"}
                            </span>
                            <span>
                              Size: {Math.round(c.mediaMetadata.sizeBytes / 1024)}{" "}
                              KB
                            </span>
                            {c.withdrawalReason && (
                              <span>Note: {c.withdrawalReason}</span>
                            )}
                          </div>

                          {previewUrls[c.id] && (
                            <video
                              controls
                              src={previewUrls[c.id]}
                              className="w-full max-h-56 rounded bg-black mt-2"
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Video Stitching & Durable Render Jobs */}
              <div className="p-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">
                      Video Stitching & Render Queue
                    </h3>
                    <p className="text-xs text-[var(--foreground-muted)]">
                      Jobs snapshot the ordered manifest of approved, consented
                      clips and dispatch to the asynchronous stitching queue.
                    </p>
                  </div>
                  {isEditorOrOwner &&
                    (activeProject.status === "open" ||
                      activeProject.status === "locked") && (
                      <button
                        type="button"
                        disabled={approvedClips.length === 0}
                        onClick={handleRequestRender}
                        className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium disabled:opacity-50"
                      >
                        Request Combined Video Render ({approvedClips.length}{" "}
                        clips)
                      </button>
                    )}
                </div>

                <div className="p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--foreground-muted)]">
                  <strong>Worker Infrastructure Status:</strong> Durable render-job
                  contract and manifest validator active (
                  <code className="font-mono">contract-queue-adapter</code>).
                  Synchronous FFmpeg processing inside Next.js server actions is
                  disabled by design; jobs remain durably queued until an external
                  FFmpeg media worker consumes <code className="font-mono">project_render_jobs</code>.
                </div>

                {renderJobs.length === 0 ? (
                  <p className="text-xs text-[var(--foreground-muted)]">
                    No render jobs requested yet.
                  </p>
                ) : (
                  <ul className="space-y-2.5" role="list">
                    {renderJobs.map((job) => (
                      <li
                        key={job.id}
                        className="p-3.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-semibold uppercase px-2 py-0.5 rounded border border-[var(--border)]">
                              {job.status}
                            </span>
                            <span className="text-xs font-medium">
                              {job.clipCount} consented clips in manifest
                            </span>
                            <span className="text-[11px] text-[var(--foreground-muted)]">
                              Attempt {job.attemptCount}/{job.maxAttempts} •
                              Timeout {job.timeoutSeconds}s
                            </span>
                          </div>
                          {job.outputProvenance && (() => {
                            const jobProv = formatCollaborativeProvenanceSummary(
                              job.outputProvenance
                            );
                            return (
                              <p className="text-[11px] text-[var(--foreground-secondary)]">
                                <span className="font-medium">
                                  {jobProv.headline}:
                                </span>{" "}
                                {jobProv.detailLine}
                              </p>
                            );
                          })()}
                          {job.failureReason && (
                            <p className="text-xs text-rose-600 dark:text-rose-400">
                              Failure reason: {job.failureReason}
                            </p>
                          )}
                        </div>
                        {isEditorOrOwner &&
                          job.status === "failed" &&
                          job.attemptCount < job.maxAttempts && (
                            <button
                              type="button"
                              onClick={() => handleRetryJob(job.id)}
                              className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-xs font-medium hover:bg-[var(--surface-muted)]"
                            >
                              Retry Render Job
                            </button>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Participants & Invitations Roster */}
              <div className="p-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4">
                <h3 className="text-base font-semibold">
                  Project Participants ({participants.length})
                </h3>

                {isEditorOrOwner && (
                  <form
                    onSubmit={handleInviteUser}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input
                      type="text"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      placeholder="Invite by @username"
                      aria-label="Invite participant by username"
                      className="p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-xs flex-1 min-w-[180px]"
                    />
                    {isOwner && (
                      <select
                        value={inviteRole}
                        onChange={(e) =>
                          setInviteRole(
                            e.target.value as "contributor" | "editor"
                          )
                        }
                        aria-label="Invitation role"
                        className="p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-xs"
                      >
                        <option value="contributor">Contributor</option>
                        <option value="editor">Editor</option>
                      </select>
                    )}
                    <button
                      type="submit"
                      disabled={isInviting || !inviteUsername.trim()}
                      className="px-3.5 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium disabled:opacity-50"
                    >
                      Invite
                    </button>
                  </form>
                )}

                <ul className="divide-y divide-[var(--border)]" role="list">
                  {participants.map((pt) => (
                    <li
                      key={pt.id}
                      className="py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">@{pt.username}</span>
                        <span className="font-mono uppercase px-1.5 py-0.5 rounded border border-[var(--border)]">
                          {pt.role}
                        </span>
                        <span className="text-[var(--foreground-muted)]">
                          ({pt.status})
                        </span>
                      </div>

                      {isEditorOrOwner && pt.role !== "owner" && (
                        <div className="flex items-center gap-1.5">
                          {pt.status === "requested" && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleParticipantManagement(
                                    pt.userId,
                                    "approve_request"
                                  )
                                }
                                className="px-2 py-1 rounded bg-emerald-600 text-white"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleParticipantManagement(
                                    pt.userId,
                                    "reject_request"
                                  )
                                }
                                className="px-2 py-1 rounded border border-[var(--border)]"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {isOwner &&
                            pt.status === "active" &&
                            pt.role === "contributor" && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleParticipantManagement(
                                    pt.userId,
                                    "promote_editor"
                                  )
                                }
                                className="px-2 py-1 rounded border border-[var(--border)]"
                              >
                                Make Editor
                              </button>
                            )}
                          {isOwner &&
                            pt.status === "active" &&
                            pt.role === "editor" && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleParticipantManagement(
                                    pt.userId,
                                    "demote_contributor"
                                  )
                                }
                                className="px-2 py-1 rounded border border-[var(--border)]"
                              >
                                Demote to Contributor
                              </button>
                            )}
                          {pt.status === "active" &&
                            (isOwner || pt.role === "contributor") && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleParticipantManagement(
                                    pt.userId,
                                    "remove"
                                  )
                                }
                                className="px-2 py-1 rounded border border-rose-300 text-rose-700 dark:text-rose-300"
                              >
                                Remove
                              </button>
                            )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Create Collaborative Project Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-collab-project-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <form
            onSubmit={handleCreateProject}
            className="w-full max-w-lg rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4 shadow-xl"
          >
            <h2
              id="create-collab-project-title"
              className="text-lg font-bold tracking-tight"
            >
              Create Collaborative Video Project
            </h2>

            <div>
              <label
                htmlFor="proj-title-input"
                className="block text-xs font-medium mb-1"
              >
                Project Title
              </label>
              <input
                id="proj-title-input"
                type="text"
                required
                minLength={2}
                maxLength={150}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Community Solar Build Time-Lapse"
                className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="proj-desc-input"
                className="block text-xs font-medium mb-1"
              >
                Project Brief & Guidelines
              </label>
              <textarea
                id="proj-desc-input"
                rows={3}
                maxLength={2000}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe what clips contributors should submit and how the final video will be arranged."
                className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="proj-vis-select"
                  className="block text-xs font-medium mb-1"
                >
                  Visibility
                </label>
                <select
                  id="proj-vis-select"
                  value={newVisibility}
                  onChange={(e) => {
                    const v = e.target.value as ProjectVisibility;
                    setNewVisibility(v);
                    if (v === "private") {
                      setNewParticipationMode("invite_only");
                    }
                  }}
                  className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-sm"
                >
                  <option value="public">Public</option>
                  <option value="private">Private (Participants Only)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="proj-part-select"
                  className="block text-xs font-medium mb-1"
                >
                  Participation Mode
                </label>
                <select
                  id="proj-part-select"
                  value={
                    newVisibility === "private"
                      ? "invite_only"
                      : newParticipationMode
                  }
                  disabled={newVisibility === "private"}
                  onChange={(e) =>
                    setNewParticipationMode(e.target.value as ParticipationMode)
                  }
                  className="w-full p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-sm disabled:opacity-60"
                >
                  <option value="open">Open Enrollment</option>
                  <option value="invite_only">Invite / Approval Only</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingCreate}
                className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium disabled:opacity-50"
              >
                {isSubmittingCreate ? "Creating…" : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
