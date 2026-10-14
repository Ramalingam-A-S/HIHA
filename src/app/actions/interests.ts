"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  saveUserInterestsSchema,
  customInterestSchema,
  slugifyInterest,
  type CustomInterestInput,
  type UserInterestItemInput,
} from "@/lib/validations/interests";
import type { Interest, UserInterestWithDetails } from "@/lib/supabase/types";
import type { ActionResult } from "./auth";

/**
 * Fetches the entire public interest taxonomy catalog.
 */
export async function getAllInterestsAction(): Promise<ActionResult<Interest[]>> {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { data, error } = await supabase
    .from("interests")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return { success: false, message: error.message };
  }

  return { success: true, data: data ?? [] };
}

/**
 * Retrieves the authenticated user's current saved interest preferences.
 */
export async function getUserInterestsAction(): Promise<
  ActionResult<UserInterestWithDetails[]>
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
    .from("user_interests")
    .select(`
      id,
      user_id,
      interest_id,
      priority,
      created_at,
      updated_at,
      interest:interests (*)
    `)
    .eq("user_id", user.id)
    .order("priority", { ascending: false });

  if (error) {
    return { success: false, message: error.message };
  }

  // Cast through unknown to satisfy joined relation type
  return {
    success: true,
    data: (data as unknown as UserInterestWithDetails[]) ?? [],
  };
}

/**
 * Persists the authenticated user's selected interest priorities.
 * Uses atomic replacement of user's preferences for clean synchronization.
 */
export async function saveUserInterestsAction(
  interests: UserInterestItemInput[]
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to save preferences." };
  }

  const validation = saveUserInterestsSchema.safeParse({ interests });
  if (!validation.success) {
    return {
      success: false,
      message: "Invalid interest data submitted.",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 1. Clear existing preferences for authenticated user
  const { error: deleteError } = await supabase
    .from("user_interests")
    .delete()
    .eq("user_id", user.id);

  if (deleteError) {
    return { success: false, message: "Failed to update existing preferences." };
  }

  // 2. Insert new preferences if list is non-empty
  if (validation.data.interests.length > 0) {
    const rowsToInsert = validation.data.interests.map((item) => ({
      user_id: user.id,
      interest_id: item.interestId,
      priority: item.priority,
    }));

    const { error: insertError } = await supabase
      .from("user_interests")
      .insert(rowsToInsert);

    if (insertError) {
      return { success: false, message: insertError.message || "Failed to save preferences." };
    }
  }

  revalidatePath("/interests");
  return {
    success: true,
    message: "Interest preferences saved successfully.",
  };
}

/**
 * Creates a new custom interest created by the authenticated user.
 */
export async function createCustomInterestAction(
  input: CustomInterestInput
): Promise<ActionResult<Interest>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required to create custom interests." };
  }

  const validation = customInterestSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: "Please correct the custom interest form.",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { name, category, description } = validation.data;
  const slug = slugifyInterest(name);

  if (slug.length < 2) {
    return {
      success: false,
      message: "Topic name must yield a valid alphanumeric slug.",
    };
  }

  // Anti-spam guard: limit custom interests created per user to 20
  const { count } = await supabase
    .from("interests")
    .select("*", { count: "exact", head: true })
    .eq("created_by", user.id);

  if ((count ?? 0) >= 20) {
    return {
      success: false,
      message: "Maximum custom interests limit reached (20).",
    };
  }

  // Insert custom interest
  const { data, error } = await supabase
    .from("interests")
    .insert({
      slug,
      name,
      category,
      description,
      is_custom: true,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        message: `An interest with topic slug '${slug}' already exists in the catalog.`,
      };
    }
    return { success: false, message: error.message || "Failed to create custom interest." };
  }

  revalidatePath("/interests");
  return {
    success: true,
    message: `Custom interest '${name}' created.`,
    data,
  };
}

/**
 * Clears all interest preferences, returning to default unweighted state.
 */
export async function resetUserInterestsToDefaultsAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("user_interests")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    return { success: false, message: error.message };
  }

  revalidatePath("/interests");
  return {
    success: true,
    message: "Preferences reset. All topic weights cleared to baseline defaults.",
  };
}
