"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import { z } from "zod";
import {
  createPostSchema,
  updatePostSchema,
  publishPostSchema,
  type CreatePostInput,
  type UpdatePostInput,
  type PublishPostInput,
} from "@/lib/validations/posts";
import {
  defaultStorageProvider,
  DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
} from "@/lib/storage/supabase-storage";
import type { SupportedMediaType } from "@/lib/storage/types";
import type { ActionResult } from "./auth";
import type { PostWithDetails, Post, PostUpdate, Interest } from "@/lib/supabase/types";

/**
 * Creates a new draft or immediately published post.
 */
export async function createPostAction(
  input: CreatePostInput
): Promise<ActionResult<{ post: Post }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to create a post." };
  }

  const validation = createPostSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const validatedData = validation.data;

  // Enforce path ownership if media is attached
  if (validatedData.media_path) {
    if (!defaultStorageProvider.validatePathOwnership(user.id, validatedData.media_path)) {
      return {
        success: false,
        message: "Security violation: Media path does not belong to the authenticated creator.",
      };
    }
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const isPublished = validatedData.status === "published";
  const publishedAt = isPublished ? new Date().toISOString() : null;

  // 1. Insert post record
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .insert({
      creator_id: user.id,
      content_type: validatedData.content_type,
      caption: validatedData.caption || null,
      media_path: validatedData.media_path || null,
      media_metadata: validatedData.media_metadata || null,
      status: validatedData.status,
      visibility: validatedData.visibility,
      category: validatedData.category || null,
      ai_disclosure_status: validatedData.ai_disclosure_status,
      ai_disclosure_details:
        validatedData.ai_disclosure_status === "not_declared"
          ? null
          : validatedData.ai_disclosure_details || null,
      published_at: publishedAt,
    })
    .select("*")
    .single();

  if (postErr || !post) {
    return {
      success: false,
      message: postErr?.message || "Failed to create post.",
    };
  }

  // 2. Associate interests if provided
  if (validatedData.interestIds && validatedData.interestIds.length > 0) {
    const interestRows = validatedData.interestIds.map((interestId) => ({
      post_id: post.id,
      interest_id: interestId,
    }));

    await supabase.from("post_interests").insert(interestRows);
  }

  revalidatePath("/");
  revalidatePath("/profile");
  revalidatePath("/create");

  return {
    success: true,
    data: { post },
    message: isPublished ? "Post published successfully." : "Draft saved.",
  };
}

/**
 * Updates an existing owned post (including caption, visibility, category, interests, or AI disclosure).
 */
export async function updatePostAction(
  input: UpdatePostInput
): Promise<ActionResult<{ post: Post }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = updatePostSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const {
    postId,
    caption,
    visibility,
    category,
    interestIds,
    ai_disclosure_status,
    ai_disclosure_details,
  } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const updatePayload: PostUpdate = {};
  if (caption !== undefined) updatePayload.caption = caption;
  if (visibility !== undefined) updatePayload.visibility = visibility;
  if (category !== undefined) updatePayload.category = category;
  if (ai_disclosure_status !== undefined) {
    updatePayload.ai_disclosure_status = ai_disclosure_status;
    if (ai_disclosure_status === "not_declared") {
      updatePayload.ai_disclosure_details = null;
    } else if (ai_disclosure_details !== undefined) {
      updatePayload.ai_disclosure_details = ai_disclosure_details;
    }
  } else if (ai_disclosure_details !== undefined) {
    updatePayload.ai_disclosure_details = ai_disclosure_details;
  }

  const { data: post, error: updateErr } = await supabase
    .from("posts")
    .update(updatePayload)
    .eq("id", postId)
    .eq("creator_id", user.id)
    .select("*")
    .maybeSingle();

  if (updateErr || !post) {
    return {
      success: false,
      message: updateErr?.message || "Post not found or unauthorized.",
    };
  }

  // Replace interests if specified
  if (interestIds !== undefined) {
    await supabase.from("post_interests").delete().eq("post_id", postId);
    if (interestIds.length > 0) {
      const rows = interestIds.map((id) => ({
        post_id: postId,
        interest_id: id,
      }));
      await supabase.from("post_interests").insert(rows);
    }
  }

  revalidatePath("/");
  revalidatePath("/profile");
  revalidatePath("/communities", "layout");
  return { success: true, data: { post }, message: "Post updated." };
}

/**
 * Publishes an existing draft post.
 */
export async function publishPostAction(
  input: PublishPostInput
): Promise<ActionResult<{ post: Post }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = publishPostSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, message: "Invalid post ID." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // Verify post existence and completeness
  const { data: existing } = await supabase
    .from("posts")
    .select("content_type, media_path")
    .eq("id", validation.data.postId)
    .eq("creator_id", user.id)
    .maybeSingle();

  if (!existing) {
    return { success: false, message: "Draft not found or unauthorized." };
  }

  if (existing.content_type !== "text" && !existing.media_path) {
    return {
      success: false,
      message: "Cannot publish media post without uploaded media.",
    };
  }

  const { data: post, error } = await supabase
    .from("posts")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
    })
    .eq("id", validation.data.postId)
    .eq("creator_id", user.id)
    .select("*")
    .single();

  if (error || !post) {
    return { success: false, message: error?.message || "Failed to publish post." };
  }

  revalidatePath("/profile");
  return { success: true, data: { post }, message: "Post published." };
}

/**
 * Deletes an owned post and any associated storage media.
 */
export async function deletePostAction(postId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 1. Fetch post to get media_path
  const { data: post } = await supabase
    .from("posts")
    .select("media_path")
    .eq("id", postId)
    .eq("creator_id", user.id)
    .maybeSingle();

  if (!post) {
    return { success: false, message: "Post not found or unauthorized." };
  }

  // 2. Delete media from storage if exists
  if (post.media_path) {
    await defaultStorageProvider.deleteFile(user.id, post.media_path);
  }

  // 3. Delete post row (cascades to post_interests)
  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("creator_id", user.id);

  if (error) {
    return { success: false, message: error.message };
  }

  revalidatePath("/profile");
  return { success: true, message: "Post deleted." };
}

/**
 * Requests a signed upload intent from the storage provider for direct client upload.
 */
export async function getUploadIntentAction(
  filename: string,
  mediaType: SupportedMediaType
): Promise<ActionResult<{ path: string; signedUploadUrl: string; token?: string }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required for uploads." };
  }

  const intent = await defaultStorageProvider.createUploadIntent(
    user.id,
    filename,
    mediaType
  );

  if (!intent.success || !intent.data) {
    return {
      success: false,
      message: intent.error || "Failed to generate upload authorization.",
    };
  }

  return {
    success: true,
    data: {
      path: intent.data.path,
      signedUploadUrl: intent.data.signedUploadUrl,
      token: intent.data.token,
    },
  };
}

/**
 * Fetches an individual post by ID if accessible to the caller.
 * Note: Raw media_path is masked for non-creators to prevent direct storage probing.
 * Viewers must use getPostMediaUrlAction to request an authorized, time-limited URL.
 */
export async function getPostAction(
  postId: string
): Promise<ActionResult<PostWithDetails>> {
  const user = await getCurrentUser();
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data: post, error } = await supabase
    .from("posts")
    .select(`
      *,
      creator:profiles!posts_creator_id_fkey (*),
      post_interests (
        interest:interests (*)
      )
    `)
    .eq("id", postId)
    .maybeSingle();

  if (error || !post) {
    return { success: false, message: "Post not found or unavailable." };
  }

  // Flatten interests
  const rawPostInterests = post.post_interests as unknown as Array<{ interest: Interest }>;
  const interests = rawPostInterests?.map((pi) => pi.interest).filter(Boolean) ?? [];

  // Protect internal storage paths: only the creator retains raw media_path
  const isOwner = user?.id === post.creator_id;
  const sanitizedPost = isOwner ? post : { ...post, media_path: null };

  const result: PostWithDetails = {
    ...(sanitizedPost as unknown as PostWithDetails),
    interests,
  };

  return { success: true, data: result };
}

/**
 * Authorizes and generates a short-lived signed download URL for a post's media.
 * Enforces server-session authentication, post-level RLS visibility (draft, private,
 * followers, and block checks), and path association with the specific post.
 */
export async function getPostMediaUrlAction(
  postId: string
): Promise<ActionResult<{ signedUrl: string; expiresInSeconds: number }>> {
  // 1. Validate postId with Zod
  const validation = z.string().uuid("Invalid post ID").safeParse(postId);
  if (!validation.success) {
    return { success: false, message: "Invalid post ID." };
  }

  // 2. Verify authenticated user
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to access media." };
  }

  // 3. User-scoped Supabase client so posts RLS is strictly enforced
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 4. Query post (RLS enforces status, visibility, followers, and block filtering)
  const { data: post, error } = await supabase
    .from("posts")
    .select("id, creator_id, media_path, status, visibility")
    .eq("id", validation.data)
    .maybeSingle();

  // 5. Generic unavailable response if not visible or has no media attached
  if (error || !post || !post.media_path) {
    return { success: false, message: "Media unavailable or post not accessible." };
  }

  // 6. Confirm stored media path belongs to the expected creator prefix
  if (!defaultStorageProvider.validatePathOwnership(post.creator_id, post.media_path)) {
    return { success: false, message: "Invalid media association." };
  }

  // 7. Generate signed download URL with short expiry (300 seconds / 5 minutes)
  const expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
  const signedUrl = await defaultStorageProvider.getSignedUrl(
    post.media_path,
    expiresInSeconds
  );

  if (!signedUrl) {
    return { success: false, message: "Unable to generate media authorization." };
  }

  // 8. Return URL and expiry metadata only
  return {
    success: true,
    data: {
      signedUrl,
      expiresInSeconds,
    },
  };
}
