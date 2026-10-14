"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  createCommunitySchema,
  communityQuerySchema,
  type CreateCommunityInput,
  type CommunityQueryInput,
  type CommunityWithDetails,
  type CommunityMemberWithProfile,
} from "@/lib/communities/types";
import type { ActionResult } from "./auth";
import type { Community, Profile, Interest } from "@/lib/supabase/types";

/**
 * Creates a new community (public or private).
 * The creator is automatically provisioned as the active owner via database trigger.
 */
export async function createCommunityAction(
  input: CreateCommunityInput
): Promise<ActionResult<Community>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to create a community." };
  }

  const validation = createCommunitySchema.safeParse(input);
  if (!validation.success) {
    return { success: false, message: validation.error.issues[0]?.message || "Invalid community data." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { name, slug, description, visibility, interestId, category } = validation.data;

  const { data, error } = await supabase
    .from("communities")
    .insert({
      owner_id: user.id,
      name,
      slug,
      description: description || null,
      visibility,
      interest_id: interestId || null,
      category: category || null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { success: false, message: "This community slug is already in use. Please choose another." };
    }
    return { success: false, message: "Unable to create community. Please try again." };
  }

  revalidatePath("/communities");
  return { success: true, data };
}

/**
 * Lists discoverable communities with bounded pagination and search.
 */
export async function getCommunitiesAction(
  input?: CommunityQueryInput
): Promise<ActionResult<{ items: CommunityWithDetails[]; hasMore: boolean }>> {
  const user = await getCurrentUser();
  const validation = communityQuerySchema.safeParse(input || {});
  if (!validation.success) {
    return { success: false, message: "Invalid query parameters." };
  }

  const { page, pageSize, category, search } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;

  let query = supabase
    .from("communities")
    .select(
      `
      *,
      owner:profiles!communities_owner_id_fkey (*),
      interest:interests!communities_interest_id_fkey (*)
    `
    )
    .order("created_at", { ascending: false })
    .range(fromIndex, toIndex);

  if (category) {
    query = query.eq("category", category);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  }

  const { data: rawCommunities, error } = await query;
  if (error) {
    return { success: false, message: "Failed to load communities." };
  }

  const communityIds = (rawCommunities ?? []).map((c) => c.id);

  // Batch query active member counts and viewer membership
  const memberCountMap = new Map<string, number>();
  const viewerMembershipMap = new Map<string, { role: "owner" | "moderator" | "member"; status: "active" | "pending" | "rejected" | "banned" }>();

  if (communityIds.length > 0) {
    const [membersRes, viewerRes] = await Promise.all([
      supabase
        .from("community_members")
        .select("community_id")
        .in("community_id", communityIds)
        .eq("status", "active"),
      user
        ? supabase
            .from("community_members")
            .select("community_id, role, status")
            .in("community_id", communityIds)
            .eq("user_id", user.id)
        : Promise.resolve({ data: null }),
    ]);

    for (const row of membersRes?.data ?? []) {
      memberCountMap.set(row.community_id, (memberCountMap.get(row.community_id) ?? 0) + 1);
    }

    if (viewerRes?.data) {
      for (const row of viewerRes.data) {
        viewerMembershipMap.set(row.community_id, { role: row.role, status: row.status });
      }
    }
  }

  const items: CommunityWithDetails[] = (rawCommunities ?? []).map((c) => ({
    ...c,
    owner: c.owner as unknown as Profile,
    interest: (c.interest as unknown as Interest) ?? null,
    memberCount: memberCountMap.get(c.id) ?? 1,
    viewerMembership: viewerMembershipMap.get(c.id) ?? null,
  }));

  return {
    success: true,
    data: {
      items,
      hasMore: items.length === pageSize,
    },
  };
}

/**
 * Fetches a single community by slug with details and viewer membership state.
 */
export async function getCommunityBySlugAction(
  slug: string
): Promise<ActionResult<CommunityWithDetails>> {
  if (!slug || typeof slug !== "string") {
    return { success: false, message: "Invalid community slug." };
  }

  const user = await getCurrentUser();
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: rawCommunity, error } = await supabase
    .from("communities")
    .select(
      `
      *,
      owner:profiles!communities_owner_id_fkey (*),
      interest:interests!communities_interest_id_fkey (*)
    `
    )
    .eq("slug", slug.toLowerCase())
    .single();

  if (error || !rawCommunity) {
    return { success: false, message: "Community not found or access restricted." };
  }

  // Count active members and viewer membership
  const [countRes, viewerRes] = await Promise.all([
    supabase
      .from("community_members")
      .select("id", { count: "exact", head: true })
      .eq("community_id", rawCommunity.id)
      .eq("status", "active"),
    user
      ? supabase
          .from("community_members")
          .select("role, status")
          .eq("community_id", rawCommunity.id)
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const community: CommunityWithDetails = {
    ...rawCommunity,
    owner: rawCommunity.owner as unknown as Profile,
    interest: (rawCommunity.interest as unknown as Interest) ?? null,
    memberCount: countRes.count ?? 1,
    viewerMembership: viewerRes?.data ? { role: viewerRes.data.role, status: viewerRes.data.status } : null,
  };

  return { success: true, data: community };
}

/**
 * Joins a public community directly, or submits a pending membership request for a private community.
 */
export async function joinCommunityAction(
  communityId: string
): Promise<ActionResult<{ status: "active" | "pending" }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to join communities." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Use the SECURITY DEFINER RPC to request or join community
  const { data: memberRecord, error: rpcErr } = await (supabase.rpc as unknown as (
    fn: string,
    args: { c_id: string }
  ) => Promise<{ data: { status: "active" | "pending" } | null; error: { code?: string; message?: string } | null }>)(
    "request_community_membership",
    { c_id: communityId }
  );

  if (rpcErr || !memberRecord) {
    if (rpcErr?.code === "23505" || rpcErr?.message?.includes("unique")) {
      return { success: false, message: "You are already a member or have a pending request." };
    }
    return { success: false, message: rpcErr?.message || "Unable to join community. Access may be restricted." };
  }

  const targetStatus = memberRecord.status;

  revalidatePath("/communities");
  return {
    success: true,
    data: { status: targetStatus },
    message: targetStatus === "active" ? "Joined community successfully." : "Membership request submitted.",
  };
}

/**
 * Leaves a community. Owners cannot leave without first transferring ownership.
 */
export async function leaveCommunityAction(
  communityId: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: member, error: checkErr } = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", communityId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (checkErr || !member) {
    return { success: false, message: "You are not a member of this community." };
  }

  if (member.role === "owner") {
    return {
      success: false,
      message: "Community owners cannot leave. Please transfer ownership before leaving.",
    };
  }

  const { error: delErr } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", user.id);

  if (delErr) {
    return { success: false, message: "Failed to leave community." };
  }

  revalidatePath("/communities");
  return { success: true, message: "Left community successfully." };
}

/**
 * Approves or rejects a pending membership request.
 * Can only be performed by the owner or a moderator.
 */
export async function respondToMembershipRequestAction(params: {
  communityId: string;
  targetUserId: string;
  decision: "approve" | "reject";
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const { communityId, targetUserId, decision } = params;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  if (decision === "approve") {
    const { error } = await supabase
      .from("community_members")
      .update({ status: "active" })
      .eq("community_id", communityId)
      .eq("user_id", targetUserId)
      .eq("status", "pending");

    if (error) {
      return { success: false, message: "Unable to approve request. Permission denied." };
    }
  } else {
    const { error } = await supabase
      .from("community_members")
      .delete()
      .eq("community_id", communityId)
      .eq("user_id", targetUserId)
      .eq("status", "pending");

    if (error) {
      return { success: false, message: "Unable to reject request. Permission denied." };
    }
  }

  revalidatePath("/communities");
  return {
    success: true,
    message: decision === "approve" ? "Request approved." : "Request rejected.",
  };
}

/**
 * Removes a member from the community.
 * Moderators can remove members; Owners can remove moderators and members.
 */
export async function removeCommunityMemberAction(params: {
  communityId: string;
  targetUserId: string;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const { communityId, targetUserId } = params;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", targetUserId);

  if (error) {
    return { success: false, message: "Unable to remove member. Permission denied." };
  }

  revalidatePath("/communities");
  return { success: true, message: "Member removed." };
}

/**
 * Promotes a member to moderator or demotes a moderator to member.
 * Only the community owner can perform this action.
 */
export async function updateMemberRoleAction(params: {
  communityId: string;
  targetUserId: string;
  newRole: "moderator" | "member";
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const { communityId, targetUserId, newRole } = params;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Verify caller is owner
  const { data: callerMember } = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", communityId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerMember?.role !== "owner") {
    return { success: false, message: "Only the community owner can modify staff roles." };
  }

  const { error } = await supabase
    .from("community_members")
    .update({ role: newRole })
    .eq("community_id", communityId)
    .eq("user_id", targetUserId)
    .eq("status", "active");

  if (error) {
    return { success: false, message: "Failed to update role. Permission denied." };
  }

  revalidatePath("/communities");
  return { success: true, message: `Member role updated to ${newRole}.` };
}

/**
 * Safely transfers ownership to an active member.
 * The previous owner becomes a moderator.
 */
export async function transferCommunityOwnershipAction(params: {
  communityId: string;
  newOwnerId: string;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const { communityId, newOwnerId } = params;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 1. Verify caller is current owner
  const { data: community, error: comErr } = await supabase
    .from("communities")
    .select("owner_id")
    .eq("id", communityId)
    .single();

  if (comErr || community?.owner_id !== user.id) {
    return { success: false, message: "Only the current owner can transfer ownership." };
  }

  // 2. Verify target is an active member
  const { data: targetMember, error: targetErr } = await supabase
    .from("community_members")
    .select("role, status")
    .eq("community_id", communityId)
    .eq("user_id", newOwnerId)
    .maybeSingle();

  if (targetErr || targetMember?.status !== "active") {
    return { success: false, message: "Target user must be an active member of the community." };
  }

  // 3. Update community owner_id
  const { error: ownerUpErr } = await supabase
    .from("communities")
    .update({ owner_id: newOwnerId })
    .eq("id", communityId);

  if (ownerUpErr) {
    return { success: false, message: "Failed to transfer community ownership." };
  }

  // 4. Update member roles: target becomes owner, previous owner becomes moderator
  await Promise.all([
    supabase
      .from("community_members")
      .update({ role: "owner" })
      .eq("community_id", communityId)
      .eq("user_id", newOwnerId),
    supabase
      .from("community_members")
      .update({ role: "moderator" })
      .eq("community_id", communityId)
      .eq("user_id", user.id),
  ]);

  revalidatePath("/communities");
  return { success: true, message: "Ownership transferred successfully." };
}

/**
 * Fetches active members for a community.
 */
export async function getCommunityMembersAction(
  communityId: string,
  page = 1,
  pageSize = 20
): Promise<ActionResult<{ items: CommunityMemberWithProfile[]; hasMore: boolean }>> {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;

  const { data, error } = await supabase
    .from("community_members")
    .select(
      `
      *,
      user:profiles!community_members_user_id_fkey (*)
    `
    )
    .eq("community_id", communityId)
    .eq("status", "active")
    .order("role", { ascending: true }) // owner first, then moderator, then member
    .order("created_at", { ascending: true })
    .range(fromIndex, toIndex);

  if (error) {
    return { success: false, message: "Unable to load community members." };
  }

  const items: CommunityMemberWithProfile[] = (data ?? []).map((m) => ({
    ...m,
    user: m.user as unknown as Profile,
  }));

  return {
    success: true,
    data: {
      items,
      hasMore: items.length === pageSize,
    },
  };
}

/**
 * Fetches pending membership requests for community moderators/owners.
 */
export async function getCommunityPendingRequestsAction(
  communityId: string
): Promise<ActionResult<CommunityMemberWithProfile[]>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data, error } = await supabase
    .from("community_members")
    .select(
      `
      *,
      user:profiles!community_members_user_id_fkey (*)
    `
    )
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    return { success: false, message: "Unable to load pending requests. Permission denied." };
  }

  const items: CommunityMemberWithProfile[] = (data ?? []).map((m) => ({
    ...m,
    user: m.user as unknown as Profile,
  }));

  return { success: true, data: items };
}
