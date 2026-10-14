"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import { postIdSchema, type LikeActionResult } from "@/lib/likes/types";
import type { ActionResult } from "./auth";

/**
 * Likes a post on behalf of the authenticated user.
 * Idempotent, RLS-enforced (cannot like drafts, private, or inaccessible posts).
 */
export async function likePostAction(
  postId: string
): Promise<ActionResult<LikeActionResult>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to like posts." };
  }

  const validation = postIdSchema.safeParse({ postId });
  if (!validation.success) {
    return { success: false, message: "Invalid post identifier." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Insert like with ON CONFLICT DO NOTHING for idempotency and concurrency safety.
  // RLS WITH CHECK ensures post is visible to caller (not draft/private/blocked/unfollowed).
  const { error } = await supabase
    .from("post_likes")
    .upsert(
      {
        post_id: postId,
        user_id: user.id,
      },
      { onConflict: "post_id,user_id", ignoreDuplicates: true }
    );

  if (error) {
    const lower = error.message?.toLowerCase() ?? "";
    if (lower.includes("rate limit exceeded")) {
      return {
        success: false,
        message:
          "Rate limit exceeded: repeated like toggling or rapid liking is temporarily restricted.",
      };
    }
    if (lower.includes("restricted")) {
      return {
        success: false,
        message: "This action is unavailable due to an active account or content restriction.",
      };
    }
    if (
      lower.includes("disabled interactions") ||
      lower.includes("approved followers")
    ) {
      return {
        success: false,
        message: error.message,
      };
    }
    // Generic safe error message to prevent leaking existence of private posts
    return {
      success: false,
      message: "Unable to like this post. It may be private or unavailable.",
    };
  }

  // Get accurate database count
  const { count, error: countErr } = await supabase
    .from("post_likes")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId);

  if (countErr) {
    return { success: false, message: "Failed to update like counter." };
  }

  revalidatePath("/feed");
  return {
    success: true,
    data: {
      isLiked: true,
      likeCount: count ?? 1,
    },
  };
}

/**
 * Unlikes a post on behalf of the authenticated user.
 * Idempotent: succeeds even if the post was not previously liked.
 */
export async function unlikePostAction(
  postId: string
): Promise<ActionResult<LikeActionResult>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to unlike posts." };
  }

  const validation = postIdSchema.safeParse({ postId });
  if (!validation.success) {
    return { success: false, message: "Invalid post identifier." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("post_likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", user.id);

  if (error) {
    return { success: false, message: "Unable to update like status." };
  }

  // Get accurate database count
  const { count, error: countErr } = await supabase
    .from("post_likes")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId);

  if (countErr) {
    return { success: false, message: "Failed to update like counter." };
  }

  revalidatePath("/feed");
  return {
    success: true,
    data: {
      isLiked: false,
      likeCount: count ?? 0,
    },
  };
}
