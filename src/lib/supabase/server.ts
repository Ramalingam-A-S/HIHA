import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/env";
import type { Database, Profile } from "./types";

/**
 * Creates a Supabase client for Server Components, Server Actions, and Route Handlers.
 * Uses Next.js 15 async cookies() with @supabase/ssr.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseConfig();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Can be safely ignored if called from a Server Component
          // while middleware refreshes cookies.
        }
      },
    },
  });
}

/**
 * Returns a server client if configured, otherwise null.
 */
export async function tryCreateClient(): Promise<SupabaseClient<Database> | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  return createClient();
}

/**
 * Validates and retrieves the authenticated user using getUser().
 * Never rely solely on client-side state or getSession() for server authorization.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await tryCreateClient();
  if (!supabase) return null;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

/**
 * Retrieves the current authenticated user's profile.
 */
export async function getCurrentUserProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await tryCreateClient();
  if (!supabase) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile ?? null;
}
