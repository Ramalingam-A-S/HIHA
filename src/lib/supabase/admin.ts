import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig, isSupabaseAdminConfigured } from "@/lib/env";
import type { Database } from "./types";

// Runtime guardrail: prevent accidental bundling or evaluation in client/browser environments
if (typeof window !== "undefined") {
  throw new Error(
    "Security Violation: Supabase admin client cannot be imported or executed in browser bundles."
  );
}

/**
 * Creates a server-only Supabase client authenticated with SUPABASE_SERVICE_ROLE_KEY.
 * Restricted strictly to narrow server actions and lifecycle operations:
 *  - Supabase Auth admin deletion (auth.admin.deleteUser)
 *  - Cross-user storage deletion during permanent account scrubbing
 *
 * Never persist sessions or use this client for normal client/user interactions.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "Security Violation: Supabase admin client cannot be called in browser contexts."
    );
  }

  const { url, serviceRoleKey } = getSupabaseAdminConfig();

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Returns a server-only Supabase admin client if SUPABASE_SERVICE_ROLE_KEY is configured,
 * otherwise returns null without throwing.
 */
export function tryCreateAdminClient(): SupabaseClient<Database> | null {
  if (!isSupabaseAdminConfigured()) {
    return null;
  }
  return createAdminClient();
}
