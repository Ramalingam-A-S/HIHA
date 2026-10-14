"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@/lib/validations/profile";
import type { Profile } from "@/lib/supabase/types";
import type { ActionResult } from "./auth";

/**
 * Updates the authenticated user's profile details (display name, bio, privacy).
 * Ownership is enforced on the server and via Row Level Security in Postgres.
 */
export async function updateProfileAction(
  input: UpdateProfileInput
): Promise<ActionResult<Profile>> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      message: "You must be signed in to update your profile.",
    };
  }

  const validation = updateProfileSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: "Validation failed. Please correct the fields below.",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return {
      success: false,
      message: "Database connection unavailable.",
    };
  }

  const { displayName, bio, isPrivate } = validation.data;

  // Server-side authorization check: only updates where id = authenticated user's id
  const { data: updatedProfile, error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      bio: bio ?? null,
      is_private: isPrivate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("*")
    .single();

  if (error) {
    return {
      success: false,
      message: error.message || "Failed to update profile.",
    };
  }

  revalidatePath("/profile");
  return {
    success: true,
    message: "Profile updated successfully.",
    data: updatedProfile,
  };
}
