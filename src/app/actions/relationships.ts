"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  targetUserSchema,
  followResponseSchema,
  type FollowResponseInput,
} from "@/lib/validations/relationships";
import type { ActionResult } from "./auth";
import type { Profile } from "@/lib/supabase/types";
import { evaluateFollowPermission } from "@/lib/privacy/types";

export interface RelationshipState {
  isFollowing: boolean;
  isPendingOutgoing: boolean;
  isFollower: boolean;
  isPendingIncoming: boolean;
  incomingFollowId?: string;
  isBlockedByMe: boolean;
  isBlockedByThem: boolean;
  isMuted: boolean;
}

export interface IncomingRequestItem {
  id: string;
  follower_id: string;
  created_at: string;
  follower: Profile;
}

/**
 * Retrieves the bidirectional social relationship state between the authenticated
 * user and a target user.
 */
export async function getRelationshipStateAction(
  targetUserId: string
): Promise<ActionResult<RelationshipState>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 1. Check Blocks in both directions
  const { data: blocks } = await supabase
    .from("blocks")
    .select("blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${user.id},blocked_id.eq.${targetUserId}),and(blocker_id.eq.${targetUserId},blocked_id.eq.${user.id})`
    );

  const isBlockedByMe = blocks?.some(
    (b) => b.blocker_id === user.id && b.blocked_id === targetUserId
  ) ?? false;
  const isBlockedByThem = blocks?.some(
    (b) => b.blocker_id === targetUserId && b.blocked_id === user.id
  ) ?? false;

  // 2. Check Follows in both directions
  const { data: follows } = await supabase
    .from("follows")
    .select("id, follower_id, following_id, status")
    .or(
      `and(follower_id.eq.${user.id},following_id.eq.${targetUserId}),and(follower_id.eq.${targetUserId},following_id.eq.${user.id})`
    );

  const outgoing = follows?.find(
    (f) => f.follower_id === user.id && f.following_id === targetUserId
  );
  const incoming = follows?.find(
    (f) => f.follower_id === targetUserId && f.following_id === user.id
  );

  // 3. Check Mutes
  const { data: mutes } = await supabase
    .from("mutes")
    .select("id")
    .eq("muter_id", user.id)
    .eq("muted_id", targetUserId)
    .maybeSingle();

  return {
    success: true,
    data: {
      isFollowing: outgoing?.status === "accepted",
      isPendingOutgoing: outgoing?.status === "pending",
      isFollower: incoming?.status === "accepted",
      isPendingIncoming: incoming?.status === "pending",
      incomingFollowId: incoming?.id,
      isBlockedByMe,
      isBlockedByThem,
      isMuted: Boolean(mutes),
    },
  };
}

/**
 * Initiates following a user. For public accounts, status is immediately 'accepted'.
 * For private accounts, status is 'pending' until accepted by target.
 */
export async function followAction(
  targetUserId: string
): Promise<ActionResult<{ status: "accepted" | "pending" }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = targetUserSchema.safeParse({ targetUserId });
  if (!validation.success) {
    return { success: false, message: "Invalid target user." };
  }

  if (user.id === targetUserId) {
    return { success: false, message: "You cannot follow your own account." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 1. Verify target profile exists and inspect privacy/follow_permission if readable under RLS
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select(
      "id, username, is_private, follow_permission, age_safety_mode, deactivated_at"
    )
    .eq("id", targetUserId)
    .maybeSingle();

  // 2. Enforce block check: cannot follow if a block exists in either direction
  const { data: block } = await supabase
    .from("blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${user.id},blocked_id.eq.${targetUserId}),and(blocker_id.eq.${targetUserId},blocked_id.eq.${user.id})`
    )
    .maybeSingle();

  if (block) {
    return { success: false, message: "Unable to follow this account." };
  }

  // 3. Determine initial status based on audience privacy & follow_permission
  let status: "accepted" | "pending" = "pending";
  if (targetProfile) {
    const permCheck = evaluateFollowPermission({
      actorId: user.id,
      targetId: targetUserId,
      targetIsPrivate: targetProfile.is_private,
      targetFollowPermission: targetProfile.follow_permission ?? "everyone",
      targetAgeSafetyMode: targetProfile.age_safety_mode ?? "standard",
      isBlocked: false,
      isTargetDeactivated: Boolean(targetProfile.deactivated_at),
    });
    if (!permCheck.allowed) {
      return {
        success: false,
        message:
          permCheck.reason || "This account is not accepting new followers.",
      };
    }
    status =
      permCheck.resultingStatus ??
      (targetProfile.is_private ? "pending" : "accepted");
  }

  const { data: follow, error: followErr } = await supabase
    .from("follows")
    .upsert(
      {
        follower_id: user.id,
        following_id: targetUserId,
        status,
      },
      { onConflict: "follower_id,following_id" }
    )
    .select("status")
    .single();

  if (followErr) {
    return { success: false, message: followErr.message || "Failed to follow user." };
  }

  const finalStatus = (follow?.status as "accepted" | "pending") || status;
  const targetHandle = targetProfile?.username ? `@${targetProfile.username}` : "this account";

  revalidatePath("/network");
  revalidatePath("/profile");
  revalidatePath("/settings");

  return {
    success: true,
    data: { status: finalStatus },
    message:
      finalStatus === "accepted"
        ? `Now following ${targetHandle}.`
        : `Follow request sent to ${targetHandle}.`,
  };
}

/**
 * Unfollows a user or cancels a pending outgoing follow request.
 */
export async function unfollowAction(targetUserId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("following_id", targetUserId);

  if (error) {
    return { success: false, message: error.message };
  }

  revalidatePath("/network");
  revalidatePath("/profile");
  return { success: true, message: "Unfollowed successfully." };
}

/**
 * Responds to an incoming pending follow request (accept or reject).
 */
export async function respondToFollowRequestAction(
  input: FollowResponseInput
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = followResponseSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, message: "Invalid action." };
  }

  const { followId, action } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  if (action === "accept") {
    const { error } = await supabase
      .from("follows")
      .update({ status: "accepted" })
      .eq("id", followId)
      .eq("following_id", user.id);

    if (error) {
      return { success: false, message: error.message };
    }

    revalidatePath("/network");
    return { success: true, message: "Follow request accepted." };
  } else {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("id", followId)
      .eq("following_id", user.id);

    if (error) {
      return { success: false, message: error.message };
    }

    revalidatePath("/network");
    return { success: true, message: "Follow request rejected." };
  }
}

/**
 * Blocks a user. Automatically severs any follow relationship in either direction
 * and removes redundant mute records.
 */
export async function blockUserAction(targetUserId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  if (user.id === targetUserId) {
    return { success: false, message: "You cannot block yourself." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 1. Insert block record
  const { error: blockErr } = await supabase.from("blocks").upsert(
    {
      blocker_id: user.id,
      blocked_id: targetUserId,
    },
    { onConflict: "blocker_id,blocked_id" }
  );

  if (blockErr) {
    return { success: false, message: blockErr.message };
  }

  // 2. Sever any follow relationships in either direction
  await supabase
    .from("follows")
    .delete()
    .or(
      `and(follower_id.eq.${user.id},following_id.eq.${targetUserId}),and(follower_id.eq.${targetUserId},following_id.eq.${user.id})`
    );

  // 3. Remove redundant mute record if present
  await supabase
    .from("mutes")
    .delete()
    .eq("muter_id", user.id)
    .eq("muted_id", targetUserId);

  revalidatePath("/network");
  revalidatePath("/profile");
  revalidatePath("/settings");
  return { success: true, message: "Account blocked." };
}

/**
 * Unblocks a user.
 */
export async function unblockUserAction(targetUserId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", targetUserId);

  if (error) {
    return { success: false, message: error.message };
  }

  revalidatePath("/network");
  revalidatePath("/profile");
  revalidatePath("/settings");
  return { success: true, message: "Account unblocked." };
}

/**
 * Mutes a creator. Muting suppresses their content from feed ranking without notifying them.
 */
export async function muteUserAction(targetUserId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  if (user.id === targetUserId) {
    return { success: false, message: "You cannot mute yourself." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase.from("mutes").upsert(
    {
      muter_id: user.id,
      muted_id: targetUserId,
    },
    { onConflict: "muter_id,muted_id" }
  );

  if (error) {
    return { success: false, message: error.message };
  }

  revalidatePath("/network");
  revalidatePath("/settings");
  return { success: true, message: "Account muted. Content will be suppressed." };
}

/**
 * Unmutes a creator.
 */
export async function unmuteUserAction(targetUserId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("mutes")
    .delete()
    .eq("muter_id", user.id)
    .eq("muted_id", targetUserId);

  if (error) {
    return { success: false, message: error.message };
  }

  revalidatePath("/network");
  revalidatePath("/settings");
  return { success: true, message: "Account unmuted." };
}

/**
 * Retrieves pending incoming follow requests for the authenticated user.
 */
export async function getPendingIncomingRequestsAction(): Promise<
  ActionResult<IncomingRequestItem[]>
> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: requests, error } = await supabase
    .from("follows")
    .select(`
      id,
      follower_id,
      created_at,
      follower:profiles!follows_follower_id_fkey (*)
    `)
    .eq("following_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, message: error.message };
  }

  return {
    success: true,
    data: (requests as unknown as IncomingRequestItem[]) ?? [],
  };
}
