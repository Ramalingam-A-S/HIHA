"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { Profile, UserInterestWithDetails } from "@/lib/supabase/types";
import {
  applyTeenSafetyModeDefaults,
  reactivateAccountSchema,
  requestAccountDeletionSchema,
  sanitizePersonalDataExport,
  updatePrivacySettingsSchema,
  type AccountDeletionMode,
  type PersonalDataExportPackage,
  type PrivacyAndSafetySettingsInput,
  type RequestAccountDeletionInput,
} from "@/lib/privacy/types";
import { defaultStorageProvider } from "@/lib/storage/supabase-storage";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

export interface BlockedAccountItem {
  id: string;
  blocked_id: string;
  created_at: string;
}

export interface MutedAccountItem {
  id: string;
  muted_id: string;
  created_at: string;
  profile: {
    id: string;
    username: string;
    display_name: string;
  } | null;
}

export interface PrivacyAndSafetyOverview {
  email: string | null;
  profile: Profile;
  interests: UserInterestWithDetails[];
  blockedAccounts: BlockedAccountItem[];
  mutedAccounts: MutedAccountItem[];
  storageSummary: {
    postsCount: number;
    activeConsentedClipsCount: number;
    submittedReportsCount: number;
    ownedCommunitiesCount?: number;
    ownedMultiMemberCommunitiesCount?: number;
    ownedProjectsCount?: number;
    deletionIncomplete?: boolean;
  };
}

export interface AccountLifecycleSummary {
  mode: AccountDeletionMode;
  processed_at: string;
  deleted_posts_count: number;
  withdrawn_contributions_count: number;
  cancelled_projects_count: number;
  retained_moderation_audit_records: number;
  invalidated_output_media_paths?: string[];
  media_paths_to_delete?: string[];
  deleted_media_storage_files_count?: number;
  deletion_incomplete?: boolean;
  auth_deletion_pending?: boolean;
}

/**
 * Loads the authenticated user's complete privacy, child-safety, relationship,
 * and stored personal-data overview for the /settings page.
 */
export async function getPrivacyAndSafetyOverviewAction(): Promise<
  ActionResult<PrivacyAndSafetyOverview>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const [
    profileRes,
    interestsRes,
    blocksRes,
    mutesRes,
    postsCountRes,
    clipsCountRes,
    reportsCountRes,
    ownedCommunitiesRes,
    ownedProjectsRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase
      .from("user_interests")
      .select("*, interest:interests(*)")
      .eq("user_id", user.id)
      .order("priority", { ascending: false }),
    supabase
      .from("blocks")
      .select("id, blocked_id, created_at")
      .eq("blocker_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("mutes")
      .select("id, muted_id, created_at")
      .eq("muter_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id),
    supabase
      .from("project_contributions")
      .select("id", { count: "exact", head: true })
      .eq("contributor_id", user.id)
      .eq("consent_granted", true),
    supabase
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", user.id),
    supabase
      .from("communities")
      .select("id, name, slug")
      .eq("owner_id", user.id),
    supabase
      .from("collaborative_projects")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id),
  ]);

  const ownedCommunities = ownedCommunitiesRes.data ?? [];
  let ownedMultiMemberCommunitiesCount = 0;

  if (ownedCommunities.length > 0) {
    const commIds = ownedCommunities.map((c) => c.id);
    const { data: otherMembers } = await supabase
      .from("community_members")
      .select("community_id")
      .in("community_id", commIds)
      .neq("user_id", user.id)
      .eq("status", "active");

    const multiMemberCommIds = new Set(
      (otherMembers ?? []).map((m) => m.community_id)
    );
    ownedMultiMemberCommunitiesCount = multiMemberCommIds.size;
  }

  if (profileRes.error || !profileRes.data) {
    return {
      success: false,
      message: "Unable to load your account privacy profile.",
    };
  }

  // Enrich muted accounts with basic profile display info where accessible
  const rawMutes = mutesRes.data ?? [];
  const mutedIds = rawMutes.map((m) => m.muted_id);
  const mutedProfileMap = new Map<
    string,
    { id: string; username: string; display_name: string }
  >();

  if (mutedIds.length > 0) {
    const { data: mutedProfiles } = await supabase
      .from("profiles")
      .select("id, username, display_name")
      .in("id", mutedIds);
    for (const mp of mutedProfiles ?? []) {
      mutedProfileMap.set(mp.id, mp);
    }
  }

  const mutedAccounts: MutedAccountItem[] = rawMutes.map((m) => ({
    id: m.id,
    muted_id: m.muted_id,
    created_at: m.created_at,
    profile: mutedProfileMap.get(m.muted_id) ?? null,
  }));

  return {
    success: true,
    data: {
      email: user.email ?? null,
      profile: profileRes.data,
      interests: (interestsRes.data ?? []) as unknown as UserInterestWithDetails[],
      blockedAccounts: blocksRes.data ?? [],
      mutedAccounts,
      storageSummary: {
        postsCount: postsCountRes.count ?? 0,
        activeConsentedClipsCount: clipsCountRes.count ?? 0,
        submittedReportsCount: reportsCountRes.count ?? 0,
        ownedCommunitiesCount: ownedCommunities.length,
        ownedMultiMemberCommunitiesCount,
        ownedProjectsCount: ownedProjectsRes.count ?? 0,
        deletionIncomplete:
          profileRes.data.deletion_status === "deletion_pending" ||
          profileRes.data.display_name === "Deleted Account",
      },
    },
  };
}

/**
 * Updates the authenticated user's privacy, discoverability, follow/interaction
 * permissions, notification preferences, and age-safety mode.
 */
export async function updatePrivacyAndSafetySettingsAction(
  input: PrivacyAndSafetySettingsInput & { enforceStrictTeenValidation?: boolean }
): Promise<ActionResult<Profile>> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      message: "You must be logged in to update privacy settings.",
    };
  }

  const parsed = updatePrivacySettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message:
        parsed.error.issues[0]?.message ||
        "Please check your privacy settings and try again.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const effective = applyTeenSafetyModeDefaults(parsed.data);

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      is_private: effective.isPrivate,
      discoverable_in_search: effective.discoverableInSearch,
      follow_permission: effective.followPermission,
      interaction_permission: effective.interactionPermission,
      default_post_visibility: effective.defaultPostVisibility,
      notify_on_follow_request: effective.notifyOnFollowRequest,
      notify_on_new_follower: effective.notifyOnNewFollower,
      notify_on_follow_accepted: effective.notifyOnFollowAccepted,
      age_safety_mode: effective.ageSafetyMode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("*")
    .single();

  if (error || !data) {
    const lower = error?.message?.toLowerCase() ?? "";
    if (lower.includes("teen protective safety mode")) {
      return {
        success: false,
        message:
          "Cannot relax privacy, discoverability, follow, or interaction protections while Teen Protective Safety Mode (13–17) is active.",
      };
    }
    return {
      success: false,
      message: "Failed to save privacy settings. Please try again.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/network");
  revalidatePath("/feed");
  revalidatePath("/create");

  return {
    success: true,
    message:
      effective.ageSafetyMode === "teen_13_17"
        ? "Privacy settings saved with Teen Protective Safety Mode (13–17) enforced."
        : "Privacy & safety settings updated.",
    data,
  };
}

/**
 * Generates a structured, sanitized JSON export of the authenticated user's
 * own eligible personal data.
 */
export async function exportPersonalDataAction(): Promise<
  ActionResult<PersonalDataExportPackage>
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      message: "Authentication required to export personal data.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data, error } = await supabase.rpc("export_own_personal_data");
  if (error || !data || typeof data !== "object") {
    return {
      success: false,
      message: "Unable to generate personal data export at this time.",
    };
  }

  try {
    const sanitized = sanitizePersonalDataExport(
      data as Record<string, unknown>,
      user.id
    );
    return {
      success: true,
      message: "Personal data export generated.",
      data: sanitized,
    };
  } catch {
    return {
      success: false,
      message: "Export verification failed.",
    };
  }
}

/**
 * Executes account deactivation & personal data scrubbing or permanent account deletion
 * after verifying the user's current password and explicit confirmation phrase.
 */
export async function deleteOrDeactivateAccountAction(
  input: RequestAccountDeletionInput
): Promise<ActionResult<AccountLifecycleSummary>> {
  const user = await getCurrentUser();
  if (!user || !user.email) {
    return {
      success: false,
      message: "Authentication required to manage account deletion.",
    };
  }

  const parsed = requestAccountDeletionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message:
        parsed.error.issues[0]?.message ||
        "Invalid confirmation details provided.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Re-verify current password before executing any destructive lifecycle operation
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (authErr) {
    return {
      success: false,
      message: "Password verification failed. Please enter your current password.",
    };
  }

  if (parsed.data.mode === "deactivate_and_scrub") {
    const { data, error } = await supabase.rpc(
      "request_or_execute_account_deletion",
      {
        p_mode: "deactivate_and_scrub",
        p_confirmation: parsed.data.confirmationPhrase,
      }
    );

    if (error || !data || typeof data !== "object") {
      return {
        success: false,
        message: error?.message || "Unable to complete account deactivation.",
      };
    }

    const summary = data as unknown as AccountLifecycleSummary;

    // Delete any invalidated collaborative project output binaries from Storage
    const invalidatedPaths = (summary.invalidated_output_media_paths ?? []).filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    if (invalidatedPaths.length > 0) {
      await defaultStorageProvider.deleteFilesBatch(invalidatedPaths);
    }

    // Deactivation unpublishes posts and withdraws consents while retaining post rows for recovery
    await supabase.auth.signOut();

    revalidatePath("/settings");
    revalidatePath("/profile");
    revalidatePath("/feed");
    revalidatePath("/network");
    revalidatePath("/collaborate");

    return {
      success: true,
      message:
        "Your account has been deactivated, collaborative video consents have been withdrawn, and personal content has been scrubbed from public view.",
      data: summary,
    };
  }

  // ================================================================
  // PERMANENT DELETION FLOW (Option 1B, 2A, 3A)
  // Step 1: Preflight communities and inventory all media paths via RPC
  // ================================================================
  const { data: step1Data, error: step1Error } = await supabase.rpc(
    "request_or_execute_account_deletion",
    {
      p_mode: "permanent_delete",
      p_confirmation: parsed.data.confirmationPhrase,
    }
  );

  if (step1Error || !step1Data || typeof step1Data !== "object") {
    return {
      success: false,
      message:
        step1Error?.message ||
        "Unable to execute account deletion preflight.",
    };
  }

  const summary = step1Data as unknown as AccountLifecycleSummary;
  const mediaPathsToDelete = (summary.media_paths_to_delete ?? []).filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );

  // Step 2: Delete all inventoried media binaries (and user folder contents) via Storage API
  const storageBatchRes = await defaultStorageProvider.deleteFilesBatch(
    mediaPathsToDelete
  );
  if (!storageBatchRes.success) {
    return {
      success: false,
      message: `Failed to remove all stored media files: ${storageBatchRes.error}. Your account has been locked down; please retry permanent deletion to finish cleanup.`,
    };
  }

  const folderCleanupRes = await defaultStorageProvider.deleteUserFolderContents(
    user.id
  );
  if (!folderCleanupRes.success) {
    return {
      success: false,
      message: `Failed to empty user storage folder: ${folderCleanupRes.error}. Your account has been locked down; please retry permanent deletion to finish cleanup.`,
    };
  }

  // Step 3: Database dependent records cleanup & Auth account deletion
  const adminClient = tryCreateAdminClient();
  if (adminClient) {
    // With server-only admin client: clean up DB records without deleting auth user yet
    const { error: finalDbErr } = await supabase.rpc(
      "finalize_permanent_account_deletion",
      { p_delete_auth_user: false }
    );
    if (finalDbErr) {
      return {
        success: false,
        message:
          finalDbErr.message ||
          "Failed to finalize database records cleanup.",
      };
    }

    // Delete user authentication record via Supabase Auth Admin API
    const { error: adminAuthErr } = await adminClient.auth.admin.deleteUser(
      user.id
    );
    if (adminAuthErr) {
      return {
        success: false,
        message: `Database records and stored media were cleaned up, but administrative authentication account removal failed (${adminAuthErr.message}). Permanent deletion is incomplete. Please retry to finalize authentication removal.`,
        data: {
          ...summary,
          deletion_incomplete: true,
          auth_deletion_pending: true,
          deleted_media_storage_files_count:
            storageBatchRes.deletedCount + folderCleanupRes.deletedCount,
        },
      };
    }
  } else {
    // When service role key is not configured (or in SQL-governed environments):
    // finalize_permanent_account_deletion removes dependent DB records and auth.users atomically
    const { error: finalDbErr } = await supabase.rpc(
      "finalize_permanent_account_deletion",
      { p_delete_auth_user: true }
    );
    if (finalDbErr) {
      return {
        success: false,
        message:
          finalDbErr.message ||
          "Failed to finalize database and auth account deletion.",
      };
    }
  }

  // Step 4: Sign out session
  await supabase.auth.signOut();

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/feed");
  revalidatePath("/network");
  revalidatePath("/collaborate");

  return {
    success: true,
    message:
      "Your account, media files, and collaborative projects have been permanently deleted.",
    data: {
      ...summary,
      deleted_media_storage_files_count:
        storageBatchRes.deletedCount + folderCleanupRes.deletedCount,
    },
  };
}

export const requestOrExecuteAccountDeletionAction = deleteOrDeactivateAccountAction;

/**
 * Reactivates a previously deactivated account, restoring profile access with
 * protective follower-only defaults.
 */
export async function reactivateAccountAction(input?: {
  displayName?: string;
}): Promise<ActionResult<Profile>> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      message: "Authentication required to reactivate account.",
    };
  }

  const parsed = reactivateAccountSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid display name.",
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data, error } = await supabase.rpc("reactivate_own_account", {
    p_display_name: parsed.data.displayName ?? null,
  });

  if (error || !data) {
    return {
      success: false,
      message: "Unable to reactivate account at this time.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/feed");

  return {
    success: true,
    message:
      "Your account has been reactivated with protective private defaults.",
    data,
  };
}
