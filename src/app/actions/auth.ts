"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import {
  signUpSchema,
  loginSchema,
  resetPasswordSchema,
  type SignUpInput,
  type LoginInput,
  type ResetPasswordInput,
} from "@/lib/validations/auth";

export interface ActionResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: Record<string, string[]>;
}

/**
 * Signs up a new user with email, password, username, and display name.
 */
export async function signUpAction(
  input: SignUpInput
): Promise<ActionResult<{ requiresEmailConfirmation: boolean }>> {
  const validation = signUpSchema.safeParse(input);
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
      message:
        "Supabase is not configured. Please ensure your environment variables are set.",
    };
  }

  const {
    email,
    password,
    username,
    displayName,
    minimumAgeAttested,
    ageSafetyMode,
  } = validation.data;

  // Check if username is already taken before submitting
  const { data: existingUser } = await supabase
    .from("profiles")
    .select("username")
    .eq("username", username)
    .maybeSingle();

  if (existingUser) {
    return {
      success: false,
      message: "Username is already taken. Please choose another.",
      errors: {
        username: ["Username is already taken."],
      },
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
        display_name: displayName,
        age_safety_mode: ageSafetyMode,
        age_eligibility_confirmed: minimumAgeAttested ? "true" : "false",
      },
    },
  });

  if (error) {
    return {
      success: false,
      message: error.message || "Failed to create account. Please try again.",
    };
  }

  const requiresEmailConfirmation = Boolean(
    data.user && (!data.session || data.user.identities?.length === 0)
  );

  revalidatePath("/", "layout");

  return {
    success: true,
    message: requiresEmailConfirmation
      ? "Account created! A confirmation link has been sent to your email."
      : "Account created successfully!",
    data: { requiresEmailConfirmation },
  };
}

/**
 * Authenticates a user with email and password.
 */
export async function loginAction(
  input: LoginInput
): Promise<ActionResult<{ redirectTo: string }>> {
  const validation = loginSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: "Please provide a valid email and password.",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return {
      success: false,
      message:
        "Supabase is not configured. Please ensure your environment variables are set.",
    };
  }

  const { email, password } = validation.data;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Generic failure message to prevent account enumeration
    return {
      success: false,
      message: "Invalid email or password.",
    };
  }

  revalidatePath("/", "layout");
  return {
    success: true,
    data: { redirectTo: "/profile" },
  };
}

/**
 * Signs out the current authenticated user and clears session cookies.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await tryCreateClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Initiates a password reset request.
 */
export async function resetPasswordAction(
  input: ResetPasswordInput
): Promise<ActionResult> {
  const validation = resetPasswordSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: "Please provide a valid email address.",
      errors: validation.error.flatten().fieldErrors,
    };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return {
      success: false,
      message: "Supabase is not configured.",
    };
  }

  const { email } = validation.data;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/login?reset=confirmed`,
  });

  // Always return generic success to prevent email enumeration
  return {
    success: true,
    message:
      "If an account with that email exists, password reset instructions have been sent.",
  };
}
