"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { CommunityPost, Post, Profile } from "@/lib/supabase/types";

// ============================================================
// Validation schemas
// ============================================================

const shareToCommunitySchema = z.object({
  communityId: z.string().uuid("Invalid community identifier."),
  postId: z.string().uuid("Invalid post identifier."),
});

const getCommunityPostsSchema = z.object({
  communityId: z.string().uuid("Invalid community identifier."),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(50).optional().default(20),
});

const moderateCommunityPostSchema = z.object({
  communityPostId: z.string().uuid("Invalid community post identifier."),
  removalReason: z
    .string()
    .trim()
    .max(500, "Reason cannot exceed 500 characters.")
    .optional()
    .nullable(),
});

const pinCommunityPostSchema = z.object({
  communityPostId: z.string().uuid("Invalid community post identifier."),
});

// ============================================================
// Types
// ============================================================

export interface CommunityPostWithDetails extends CommunityPost {
  post: Post & { creator: Profile };
}

// ============================================================
// Actions
// ============================================================

/**
 * Shares an existing published post into a community.
 * Only the post's creator (who must be an active community member) may do this.
 * Only published posts may be shared into communities.
 * Idempotent: sharing the same post again returns the existing entry.
 */
export async function shareToCommunityAction(input: {
  communityId: string;
  postId: string;
}): Promise<ActionResult<CommunityPost>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = shareToCommunitySchema.safeParse(input);
  if (!validation.success) {
    return { success: false, message: validation.error.issues[0]?.message || "Invalid input." };
  }

  const { communityId, postId } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Upsert: ignore conflict if already shared (idempotent)
  const { data, error } = await supabase
    .from("community_posts")
    .upsert(
      { community_id: communityId, post_id: postId, poster_id: user.id },
      { onConflict: "community_id,post_id", ignoreDuplicates: true }
    )
    .select("*")
    .single();

  if (error) {
    const lower = error.message?.toLowerCase() ?? "";
    if (lower.includes("rate limit exceeded")) {
      return {
        success: false,
        message:
          "Rate limit exceeded: too many community post shares in a short period.",
      };
    }
    // RLS violation typically means not a member, or post not owned/published
    if (error.code === "42501" || error.code === "PGRST301") {
      return {
        success: false,
        message:
          "Unable to share post. You must be an active member of this community and the post must be published.",
      };
    }
    return { success: false, message: "Unable to share post. Please try again." };
  }

  revalidatePath(`/communities`);
  return { success: true, data };
}

/**
 * Lists active (non-removed) posts in a community, with pinned posts first.
 * Visibility is enforced by RLS on both communities and posts.
 */
export async function getCommunityPostsAction(input: {
  communityId: string;
  page?: number;
  pageSize?: number;
}): Promise<ActionResult<{ items: CommunityPostWithDetails[]; hasMore: boolean }>> {
  const validation = getCommunityPostsSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, message: "Invalid query parameters." };
  }

  const { communityId, page, pageSize } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const user = await getCurrentUser();
  let mutedCreatorIds = new Set<string>();
  if (user) {
    const { data: mutes } = await supabase
      .from("mutes")
      .select("muted_id")
      .eq("muter_id", user.id);
    if (mutes) {
      mutedCreatorIds = new Set(mutes.map((m) => m.muted_id));
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize; // fetch one extra to determine hasMore

  const { data, error } = await supabase
    .from("community_posts")
    .select(
      `*, post:posts!community_posts_post_id_fkey(*, creator:profiles!posts_creator_id_fkey(*))`
    )
    .eq("community_id", communityId)
    .is("removed_at", null)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return { success: false, message: "Unable to load community posts." };
  }

  const validRows = (data as unknown[]).filter((item) => {
    const raw = item as Record<string, unknown> & {
      post?: Record<string, unknown> | null;
    };
    if (!raw.post) return false;
    const creatorId = raw.post.creator_id as string | undefined;
    if (creatorId && mutedCreatorIds.has(creatorId)) return false;
    return true;
  });

  const hasMore = data.length > pageSize;
  const items = validRows.slice(0, pageSize).map((item) => {
    const raw = item as Record<string, unknown> & { post: Record<string, unknown> };
    return {
      ...raw,
      post: {
        ...raw.post,
        creator: raw.post.creator as unknown as Profile,
      },
    } as CommunityPostWithDetails;
  });

  return { success: true, data: { items, hasMore } };
}

/**
 * Removes (soft-deletes) a community post. Only staff may remove others' posts.
 * The poster may retract their own post at any time (hard delete via RLS).
 * Staff use soft removal with an optional reason (stored in removed_at/removed_by).
 */
export async function removeCommunityPostAction(input: {
  communityPostId: string;
  removalReason?: string | null;
}): Promise<ActionResult<void>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = moderateCommunityPostSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, message: validation.error.issues[0]?.message || "Invalid input." };
  }

  const { communityPostId, removalReason } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Fetch the community post to determine caller role
  const { data: cp, error: fetchErr } = await supabase
    .from("community_posts")
    .select("id, community_id, poster_id, removed_at")
    .eq("id", communityPostId)
    .single();

  if (fetchErr || !cp) {
    return { success: false, message: "Community post not found." };
  }

  if (cp.removed_at) {
    return { success: false, message: "Post has already been removed." };
  }

  const isPoster = cp.poster_id === user.id;

  if (isPoster) {
    // Poster retracts their own post — hard delete (allowed by RLS)
    const { error } = await supabase
      .from("community_posts")
      .delete()
      .eq("id", communityPostId);

    if (error) {
      return { success: false, message: "Unable to retract post." };
    }
  } else {
    // Staff soft-removal — UPDATE with removed_at, removed_by, reason (allowed by update RLS for staff)
    const { error } = await supabase
      .from("community_posts")
      .update({
        removed_at: new Date().toISOString(),
        removed_by: user.id,
        removal_reason: removalReason || null,
      })
      .eq("id", communityPostId);

    if (error) {
      if (error.code === "42501" || error.code === "PGRST301") {
        return { success: false, message: "You do not have permission to remove this post." };
      }
      return { success: false, message: "Unable to remove post." };
    }
  }

  revalidatePath(`/communities`);
  return { success: true, data: undefined };
}

/**
 * Pins a community post. Only staff may pin posts.
 * Pinning is idempotent; unpinning clears pinned_at.
 */
export async function pinCommunityPostAction(input: {
  communityPostId: string;
  pin: boolean;
}): Promise<ActionResult<void>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = pinCommunityPostSchema.safeParse({ communityPostId: input.communityPostId });
  if (!validation.success) {
    return { success: false, message: validation.error.issues[0]?.message || "Invalid input." };
  }

  const { communityPostId } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("community_posts")
    .update({ pinned_at: input.pin ? new Date().toISOString() : null })
    .eq("id", communityPostId);

  if (error) {
    if (error.code === "42501" || error.code === "PGRST301") {
      return { success: false, message: "Only community staff may pin posts." };
    }
    return { success: false, message: "Unable to update pin status." };
  }

  revalidatePath(`/communities`);
  return { success: true, data: undefined };
}

/**
 * Returns published posts owned by the caller that can be shared into a specific community.
 * Used to populate the share-to-community picker UI.
 */
export async function getShareablePostsAction(input: {
  communityId: string;
  page?: number;
  pageSize?: number;
}): Promise<ActionResult<{ items: Post[]; hasMore: boolean }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const pageSize = Math.min(input.pageSize ?? 20, 50);
  const page = Math.max(input.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  // Get IDs of posts already shared in this community to exclude them
  const { data: alreadyShared } = await supabase
    .from("community_posts")
    .select("post_id")
    .eq("community_id", input.communityId)
    .is("removed_at", null);

  const sharedIds = (alreadyShared || []).map((r) => r.post_id);

  let query = supabase
    .from("posts")
    .select("*")
    .eq("creator_id", user.id)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .range(from, to);

  if (sharedIds.length > 0) {
    query = query.not("id", "in", `(${sharedIds.map((id) => `"${id}"`).join(",")})`);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, message: "Unable to load your posts." };
  }

  const hasMore = data.length > pageSize;
  return { success: true, data: { items: data.slice(0, pageSize), hasMore } };
}
