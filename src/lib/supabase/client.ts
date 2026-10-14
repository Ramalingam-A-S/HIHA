import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "./types";

let clientInstance: SupabaseClient<Database> | null = null;

/**
 * Creates or returns the singleton Supabase browser client.
 * Safe to call in client components.
 */
export function getBrowserSupabaseClient(): SupabaseClient<Database> {
  if (clientInstance) {
    return clientInstance;
  }

  const { url, key } = getSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  clientInstance = createBrowserClient<Database>(url, key);
  return clientInstance;
}

/**
 * Returns browser client if configured, otherwise null.
 * Allows components to conditionally render setup guidance without throwing.
 */
export function tryGetBrowserSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  return getBrowserSupabaseClient();
}
