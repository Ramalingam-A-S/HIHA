"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type {
  ContentReportUpdate,
  ModerationAction,
  ModerationAppeal,
} from "@/lib/supabase/types";
import {
  submitReportSchema,
  updateReportStatusSchema,
  moderationQueueFilterSchema,
  issueModerationActionSchema,
  reverseModerationActionSchema,
  submitAppealSchema,
  reviewAppealSchema,
  getEffectiveActionStatus,
  type SubmitReportInput,
  type UpdateReportStatusInput,
  type ModerationQueueFilterInput,
  type IssueModerationActionInput,
  type ReverseModerationActionInput,
  type SubmitAppealInput,
  type ReviewAppealInput,
  type ReporterReportItem,
  type ModerationQueueItem,
  type UserModerationRecord,
  type ModerationAuditItem,
  type ModerationAppealItem,
} from "@/lib/reports/types";

// ============================================================
// Actions
// ============================================================

/**
 * Submits a content report against a post, community post, or profile.
 * Derives reporter identity strictly from the verified session.
 * Enforces no self-reporting and prevents duplicate active reports.
 */
export async function submitReportAction(
  input: SubmitReportInput
): Promise<ActionResult<{ id: string; status: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to submit a report." };
  }

  const validation = submitReportSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.issues[0]?.message || "Invalid report input.",
    };
  }

  const { targetType, targetId, reason, details } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Pre-validate self-reporting and target existence
  if (targetType === "profile") {
    if (targetId === user.id) {
      return { success: false, message: "You cannot report your own profile." };
    }
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();

    if (!prof) {
      return { success: false, message: "The reported profile does not exist." };
    }
  } else if (targetType === "post") {
    const { data: post } = await supabase
      .from("posts")
      .select("id, creator_id")
      .eq("id", targetId)
      .maybeSingle();

    if (!post) {
      return { success: false, message: "The reported post does not exist or has been removed." };
    }
    if (post.creator_id === user.id) {
      return { success: false, message: "You cannot report your own post." };
    }
  } else if (targetType === "community_post") {
    const { data: cp } = await supabase
      .from("community_posts")
      .select("id, poster_id, community_id")
      .eq("id", targetId)
      .maybeSingle();

    if (!cp) {
      return { success: false, message: "The reported community post does not exist or has been removed." };
    }
    if (cp.poster_id === user.id) {
      return { success: false, message: "You cannot report your own community post." };
    }
  }

  // Insert into content_reports (trigger handles DB validation & linking)
  const { data, error } = await supabase
    .from("content_reports")
    .insert({
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details || null,
      status: "open",
    })
    .select("id, status")
    .single();

  if (error) {
    // Unique violation: duplicate active report
    if (error.code === "23505" || error.message.includes("unique")) {
      return {
        success: false,
        message: "You already have an active report open for this item. Our team is reviewing it.",
      };
    }
    // Self-reporting or trigger exception
    if (error.message.includes("Cannot report your own")) {
      return { success: false, message: error.message };
    }
    if (error.message.includes("does not exist")) {
      return { success: false, message: "The reported target does not exist." };
    }
    return { success: false, message: "Unable to submit report. Please try again." };
  }

  return { success: true, data };
}

/**
 * Returns reports submitted by the authenticated viewer.
 * Strictly strips internal reviewer notes and reviewer identities.
 */
export async function getReporterReportsAction(): Promise<
  ActionResult<ReporterReportItem[]>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data, error } = await supabase
    .from("content_reports")
    .select("id, target_type, target_id, reason, details, status, created_at, updated_at")
    .eq("reporter_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, message: "Unable to load your reports." };
  }

  return { success: true, data: data as ReporterReportItem[] };
}

/**
 * Fetches the moderation review queue for authorized platform staff or community moderators.
 * Scoped strictly to permitted content (platform staff sees all; community moderators see only their community).
 */
export async function getModerationQueueAction(
  filter: ModerationQueueFilterInput = {}
): Promise<ActionResult<{ items: ModerationQueueItem[]; hasMore: boolean }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = moderationQueueFilterSchema.safeParse(filter);
  if (!validation.success) {
    return { success: false, message: "Invalid filter parameters." };
  }

  const { status, communityId, page, pageSize } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Check platform staff status
  const { data: isPlatformStaff } = await supabase.rpc("is_platform_staff", {
    u_id: user.id,
  });

  // If specific community requested, check community staff status
  let isCommunityModerator = false;
  if (communityId) {
    const { data: isStaff } = await supabase.rpc("is_community_staff", {
      c_id: communityId,
      u_id: user.id,
    });
    isCommunityModerator = !!isStaff;
  }

  // Deny access if user is neither platform staff nor moderator for the target community
  if (!isPlatformStaff && !isCommunityModerator) {
    // Check if user is staff of ANY community to provide helpful context or access
    const { data: anyStaff } = await supabase
      .from("community_members")
      .select("community_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "moderator"])
      .limit(1);

    if (!anyStaff || anyStaff.length === 0) {
      return { success: false, message: "Access denied. Moderator authorization required." };
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  let query = supabase
    .from("content_reports")
    .select(`
      *,
      reporter:profiles!content_reports_reporter_id_fkey(id, username, display_name),
      community:communities!content_reports_community_id_fkey(id, name, slug)
    `)
    .range(from, to)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  // Scoping: If not platform staff, MUST filter by community
  if (!isPlatformStaff) {
    if (communityId) {
      query = query.eq("community_id", communityId);
    } else {
      // Find all communities where caller is staff
      const { data: staffCommunities } = await supabase
        .from("community_members")
        .select("community_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .in("role", ["owner", "moderator"]);

      const commIds = (staffCommunities || []).map((c) => c.community_id);
      if (commIds.length === 0) {
        return { success: true, data: { items: [], hasMore: false } };
      }
      query = query.in("community_id", commIds);
    }
  } else if (communityId) {
    query = query.eq("community_id", communityId);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, message: "Unable to load moderation queue." };
  }

  const hasMore = (data?.length || 0) > pageSize;
  const rawItems = (data || []).slice(0, pageSize);

  // Enrich with basic target summary
  const enriched: ModerationQueueItem[] = await Promise.all(
    rawItems.map(async (row) => {
      let targetSummary: ModerationQueueItem["targetSummary"] = null;

      try {
        if (row.target_type === "post") {
          const { data: post } = await supabase
            .from("posts")
            .select("caption, creator_id, creator:profiles!posts_creator_id_fkey(username)")
            .eq("id", row.target_id)
            .maybeSingle();

          if (post) {
            targetSummary = {
              titleOrCaption: post.caption || "[Media post]",
              authorUsername: (post.creator as unknown as { username: string })?.username || null,
              authorId: post.creator_id,
            };
          }
        } else if (row.target_type === "community_post") {
          const { data: cp } = await supabase
            .from("community_posts")
            .select("poster_id, post:posts!community_posts_post_id_fkey(caption)")
            .eq("id", row.target_id)
            .maybeSingle();

          if (cp) {
            targetSummary = {
              titleOrCaption:
                (cp.post as unknown as { caption: string })?.caption || "[Community post]",
              authorUsername: null,
              authorId: cp.poster_id,
            };
          }
        } else if (row.target_type === "profile") {
          const { data: prof } = await supabase
            .from("profiles")
            .select("id, username, display_name")
            .eq("id", row.target_id)
            .maybeSingle();

          if (prof) {
            targetSummary = {
              titleOrCaption: `Profile: ${prof.display_name}`,
              authorUsername: prof.username,
              authorId: prof.id,
            };
          }
        }
      } catch {
        // Fallback gracefully without throwing
      }

      return {
        ...(row as unknown as ModerationQueueItem),
        targetSummary,
      };
    })
  );

  return { success: true, data: { items: enriched, hasMore } };
}

/**
 * Transitions a report status (claim/in_review, resolve, or dismiss).
 * Enforces strict authorization (platform staff or relevant community staff).
 */
export async function updateReportStatusAction(
  input: UpdateReportStatusInput
): Promise<ActionResult<void>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = updateReportStatusSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.issues[0]?.message || "Invalid status update input.",
    };
  }

  const { reportId, status, resolutionNote } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Fetch report
  const { data: report, error: fetchErr } = await supabase
    .from("content_reports")
    .select("id, status, community_id")
    .eq("id", reportId)
    .single();

  if (fetchErr || !report) {
    return { success: false, message: "Report not found." };
  }

  // State machine validation: finalized reports cannot be transitioned
  if (report.status === "resolved" || report.status === "dismissed") {
    return {
      success: false,
      message: `This report has already been ${report.status} and cannot be modified.`,
    };
  }

  // Authorization check
  const { data: isPlatformStaff } = await supabase.rpc("is_platform_staff", {
    u_id: user.id,
  });

  let isAuthorized = !!isPlatformStaff;

  if (!isAuthorized && report.community_id) {
    const { data: isCommStaff } = await supabase.rpc("is_community_staff", {
      c_id: report.community_id,
      u_id: user.id,
    });
    isAuthorized = !!isCommStaff;
  }

  if (!isAuthorized) {
    return { success: false, message: "You do not have permission to moderate this report." };
  }

  const updatePayload: ContentReportUpdate = {
    status,
    reviewer_id: user.id,
    updated_at: new Date().toISOString(),
  };

  if (status === "resolved" || status === "dismissed") {
    updatePayload.reviewed_at = new Date().toISOString();
    updatePayload.resolution_note = resolutionNote || null;
  }

  const { error: updateErr } = await supabase
    .from("content_reports")
    .update(updatePayload)
    .eq("id", reportId);

  if (updateErr) {
    return { success: false, message: "Unable to update report status." };
  }

  revalidatePath("/moderation");
  return { success: true, data: undefined };
}

/**
 * Checks whether the authenticated user has moderation capabilities (platform staff or community staff).
 */
export async function checkModerationAccessAction(): Promise<
  ActionResult<{ isPlatformStaff: boolean; isCommunityModerator: boolean }>
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: true,
      data: { isPlatformStaff: false, isCommunityModerator: false },
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const [{ data: isPlatformStaff }, { data: staffRows }] = await Promise.all([
    supabase.rpc("is_platform_staff", { u_id: user.id }),
    supabase
      .from("community_members")
      .select("community_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "moderator"])
      .limit(1),
  ]);

  const hasCommRole = (staffRows?.length || 0) > 0;

  return {
    success: true,
    data: {
      isPlatformStaff: !!isPlatformStaff,
      isCommunityModerator: hasCommRole,
    },
  };
}

// ============================================================
// Milestone 4.1: Moderation Enforcement & Appeals Actions
// ============================================================

/**
 * Issues a formal moderation enforcement action (warning, content_restriction, or account_restriction).
 * Derives actor identity strictly from the verified server session and enforces global vs. community scope.
 */
export async function issueModerationAction(
  input: IssueModerationActionInput
): Promise<ActionResult<{ id: string; status: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = issueModerationActionSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.issues[0]?.message || "Invalid moderation action input.",
    };
  }

  const { targetType, targetId, actionType, reason, durationHours, reportId } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: isPlatformStaff } = await supabase.rpc("is_platform_staff", {
    u_id: user.id,
  });

  // Resolve target owner & community scope
  let targetUserId = "";
  let communityId: string | null = null;

  if (targetType === "post") {
    if (!isPlatformStaff) {
      return {
        success: false,
        message: "Global platform staff authorization is required for post enforcement actions.",
      };
    }
    const { data: post } = await supabase
      .from("posts")
      .select("id, creator_id")
      .eq("id", targetId)
      .maybeSingle();
    if (!post) {
      return { success: false, message: "Target post not found." };
    }
    targetUserId = post.creator_id;
  } else if (targetType === "profile") {
    if (!isPlatformStaff) {
      return {
        success: false,
        message: "Global platform staff authorization is required for account enforcement actions.",
      };
    }
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (!prof) {
      return { success: false, message: "Target profile not found." };
    }
    targetUserId = prof.id;
  } else if (targetType === "community_post") {
    const { data: cp } = await supabase
      .from("community_posts")
      .select("id, poster_id, community_id")
      .eq("id", targetId)
      .maybeSingle();
    if (!cp) {
      return { success: false, message: "Target community post not found." };
    }
    targetUserId = cp.poster_id;
    communityId = cp.community_id;

    if (!isPlatformStaff) {
      const { data: isCommStaff } = await supabase.rpc("is_community_staff", {
        c_id: cp.community_id,
        u_id: user.id,
      });
      if (!isCommStaff) {
        return {
          success: false,
          message: "You do not have moderator authority for this community.",
        };
      }
    }
  }

  if (targetUserId === user.id) {
    return { success: false, message: "You cannot issue a moderation action against yourself." };
  }

  const expiresAt = durationHours
    ? new Date(Date.now() + durationHours * 3600 * 1000).toISOString()
    : null;

  const { data: actionRow, error: insertErr } = await supabase
    .from("moderation_actions")
    .insert({
      actor_id: user.id,
      target_user_id: targetUserId,
      target_type: targetType,
      target_id: targetId,
      community_id: communityId,
      report_id: reportId || null,
      action_type: actionType,
      reason,
      duration_hours: durationHours || null,
      expires_at: expiresAt,
      status: "active",
    })
    .select("id, status")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505" || insertErr.message.includes("unique")) {
      return {
        success: false,
        message: "An active restriction of this type is already in effect for this target.",
      };
    }
    return {
      success: false,
      message: "Unable to issue moderation action. Please verify target status and permissions.",
    };
  }

  // If linked to an open/in_review report, finalize the report
  if (reportId) {
    await supabase
      .from("content_reports")
      .update({
        status: "resolved",
        reviewer_id: user.id,
        reviewed_at: new Date().toISOString(),
        resolution_note: `Enforcement action issued (${actionType}): ${reason.slice(0, 200)}`,
      })
      .eq("id", reportId)
      .in("status", ["open", "in_review"]);
  }

  revalidatePath("/moderation");
  revalidatePath("/feed");
  return { success: true, data: actionRow };
}

/**
 * Reverses an active moderation action while preserving its immutable audit record.
 */
export async function reverseModerationAction(
  input: ReverseModerationActionInput
): Promise<ActionResult<void>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = reverseModerationActionSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.issues[0]?.message || "Invalid reversal input.",
    };
  }

  const { actionId, reversalReason } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: actionRow } = await supabase
    .from("moderation_actions")
    .select("id, target_user_id, community_id, status")
    .eq("id", actionId)
    .maybeSingle();

  if (!actionRow) {
    return { success: false, message: "Moderation action not found." };
  }

  if (actionRow.status !== "active") {
    return { success: false, message: "This moderation action is no longer active." };
  }

  if (actionRow.target_user_id === user.id) {
    return { success: false, message: "You cannot reverse a moderation action targeting yourself." };
  }

  const { data: isPlatformStaff } = await supabase.rpc("is_platform_staff", {
    u_id: user.id,
  });

  let isAuthorized = !!isPlatformStaff;
  if (!isAuthorized && actionRow.community_id) {
    const { data: isCommStaff } = await supabase.rpc("is_community_staff", {
      c_id: actionRow.community_id,
      u_id: user.id,
    });
    isAuthorized = !!isCommStaff;
  }

  if (!isAuthorized) {
    return {
      success: false,
      message: "You do not have permission to reverse this moderation action.",
    };
  }

  const { error: updateErr } = await supabase
    .from("moderation_actions")
    .update({
      status: "reversed",
      reversed_at: new Date().toISOString(),
      reversed_by: user.id,
      reversal_reason: reversalReason,
    })
    .eq("id", actionId);

  if (updateErr) {
    return { success: false, message: "Unable to reverse moderation action." };
  }

  revalidatePath("/moderation");
  revalidatePath("/feed");
  return { success: true, data: undefined };
}

/**
 * Fetches the authenticated user's own moderation records and appeal statuses.
 * Strictly strips internal staff actor_id and report_id.
 */
export async function getUserModerationRecordsAction(): Promise<
  ActionResult<UserModerationRecord[]>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: actions, error } = await supabase
    .from("moderation_actions")
    .select(
      "id, target_type, target_id, community_id, action_type, reason, duration_hours, expires_at, status, reversed_at, reversal_reason, created_at"
    )
    .eq("target_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, message: "Unable to load your account moderation records." };
  }

  const actionIds = (actions || []).map((a) => a.id);
  const appealsMap = new Map<string, UserModerationRecord["appeal"]>();

  if (actionIds.length > 0) {
    const { data: appeals } = await supabase
      .from("moderation_appeals")
      .select("id, moderation_action_id, reason, status, reviewed_at, resolution_note, created_at")
      .in("moderation_action_id", actionIds);

    for (const app of appeals || []) {
      appealsMap.set(app.moderation_action_id, {
        id: app.id,
        reason: app.reason,
        status: app.status,
        reviewed_at: app.reviewed_at,
        resolution_note: app.resolution_note,
        created_at: app.created_at,
      });
    }
  }

  const nowMs = Date.now();
  const sanitized: UserModerationRecord[] = (actions || []).map((row) => ({
    id: row.id,
    target_type: row.target_type,
    target_id: row.target_id,
    community_id: row.community_id,
    action_type: row.action_type,
    reason: row.reason,
    duration_hours: row.duration_hours,
    expires_at: row.expires_at,
    status: row.status,
    effective_status: getEffectiveActionStatus(row.status, row.expires_at, nowMs),
    reversed_at: row.reversed_at,
    reversal_reason: row.reversal_reason,
    created_at: row.created_at,
    appeal: appealsMap.get(row.id) || null,
  }));

  return { success: true, data: sanitized };
}

/**
 * Submits an appeal against an active moderation action affecting the authenticated user.
 */
export async function submitAppealAction(
  input: SubmitAppealInput
): Promise<ActionResult<{ id: string; status: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = submitAppealSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.issues[0]?.message || "Invalid appeal input.",
    };
  }

  const { moderationActionId, reason } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: appeal, error } = await supabase
    .from("moderation_appeals")
    .insert({
      moderation_action_id: moderationActionId,
      appellant_id: user.id,
      reason,
      status: "pending",
    })
    .select("id, status")
    .single();

  if (error) {
    if (error.code === "23505" || error.message.includes("unique")) {
      return {
        success: false,
        message: "An appeal has already been submitted for this moderation action.",
      };
    }
    if (error.message.includes("already reversed or expired")) {
      return {
        success: false,
        message: "This moderation action is no longer active and cannot be appealed.",
      };
    }
    return { success: false, message: "Unable to submit appeal. Please try again." };
  }

  revalidatePath("/moderation");
  revalidatePath("/profile");
  return { success: true, data: appeal };
}

/**
 * Fetches the tamper-resistant enforcement audit log for authorized reviewers.
 */
export async function getModerationAuditLogAction(): Promise<
  ActionResult<ModerationAuditItem[]>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const accessRes = await checkModerationAccessAction();
  if (!accessRes.data?.isPlatformStaff && !accessRes.data?.isCommunityModerator) {
    return { success: false, message: "Access denied. Moderator authorization required." };
  }

  const { data: rows, error } = await supabase
    .from("moderation_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return { success: false, message: "Unable to load moderation audit history." };
  }

  const nowMs = Date.now();
  const items: ModerationAuditItem[] = (rows || []).map((r) => ({
    ...(r as ModerationAction),
    effective_status: getEffectiveActionStatus(r.status, r.expires_at, nowMs),
  }));

  return { success: true, data: items };
}

/**
 * Fetches the moderation appeals queue for authorized reviewers.
 */
export async function getModerationAppealsQueueAction(): Promise<
  ActionResult<ModerationAppealItem[]>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const accessRes = await checkModerationAccessAction();
  if (!accessRes.data?.isPlatformStaff && !accessRes.data?.isCommunityModerator) {
    return { success: false, message: "Access denied. Moderator authorization required." };
  }

  const { data: appeals, error } = await supabase
    .from("moderation_appeals")
    .select("*, action:moderation_actions!moderation_appeals_moderation_action_id_fkey(*)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return { success: false, message: "Unable to load appeals queue." };
  }

  const items: ModerationAppealItem[] = (appeals || []).map((row) => ({
    ...(row as unknown as ModerationAppeal),
    action: (row as unknown as { action: ModerationAction | null }).action || null,
  }));

  return { success: true, data: items };
}

/**
 * Reviews an appeal (under_review, approved, or rejected).
 * Approving an appeal automatically reverses the underlying moderation action at the database layer.
 */
export async function reviewAppealAction(
  input: ReviewAppealInput
): Promise<ActionResult<void>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = reviewAppealSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.issues[0]?.message || "Invalid appeal review input.",
    };
  }

  const { appealId, status, resolutionNote } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("moderation_appeals")
    .update({
      status,
      reviewer_id: user.id,
      reviewed_at: status === "approved" || status === "rejected" ? new Date().toISOString() : null,
      resolution_note: resolutionNote || null,
    })
    .eq("id", appealId);

  if (error) {
    return {
      success: false,
      message: "Unable to update appeal status. Verify permissions and appeal state.",
    };
  }

  revalidatePath("/moderation");
  revalidatePath("/feed");
  return { success: true, data: undefined };
}

