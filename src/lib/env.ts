import { z } from "zod";

/**
 * Server-only environment variables schema.
 * Secret keys and sensitive credentials must never have NEXT_PUBLIC_ prefix.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().optional(),
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  RENDER_WORKER_ENABLED: z.enum(["true", "false"]).optional(),
  FFMPEG_PATH: z.string().min(1).optional(),
  FFPROBE_PATH: z.string().min(1).optional(),
  RENDER_WORKER_EMAIL: z.string().email().optional(),
  RENDER_WORKER_PASSWORD: z.string().min(1).optional(),
});

/**
 * Client-accessible environment variables schema.
 * Only variables with NEXT_PUBLIC_ prefix are permitted here.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Validates raw server environment variables.
 * Throws a formatted error if validation fails.
 */
export function validateServerEnv(
  rawEnv: Record<string, string | undefined>
): ServerEnv {
  const result = serverEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid server environment variables:\n${formattedErrors}`
    );
  }
  return result.data;
}

/**
 * Validates raw client environment variables.
 * Throws a formatted error if validation fails.
 */
export function validateClientEnv(
  rawEnv: Record<string, string | undefined>
): ClientEnv {
  const result = clientEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid client environment variables:\n${formattedErrors}`
    );
  }
  return result.data;
}

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigError";
  }
}

/**
 * Checks whether Supabase environment variables are present.
 */
export function isSupabaseConfigured(
  rawEnv: Record<string, string | undefined> = process.env
): boolean {
  const url = rawEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    rawEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    rawEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key);
}

/**
 * Retrieves validated Supabase client configuration.
 * Throws a helpful error if Supabase credentials are missing when an auth/db feature is accessed.
 */
export function getSupabaseConfig(
  rawEnv: Record<string, string | undefined> = process.env
): { url: string; key: string } {
  const url = rawEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    rawEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    rawEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new SupabaseConfigError(
      "Supabase credentials missing. Please set NEXT_PUBLIC_SUPABASE_URL and either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env.local file."
    );
  }

  // Validate URL format
  const parsedUrl = z.string().url().safeParse(url);
  if (!parsedUrl.success) {
    throw new SupabaseConfigError(
      `Invalid NEXT_PUBLIC_SUPABASE_URL: ${url}. Must be a valid URL.`
    );
  }

  return { url, key };
}

const KNOWN_PLACEHOLDER_SERVICE_KEYS = new Set([
  "your-service-role-key-do-not-expose-to-browser",
  "your-service-role-key-here",
  "your-service-role-key",
]);

/**
 * Checks whether Supabase admin (service-role) credentials are fully configured.
 * Never exposes credentials to client or browser bundles.
 */
export function isSupabaseAdminConfigured(
  rawEnv: Record<string, string | undefined> = process.env
): boolean {
  if (typeof window !== "undefined") {
    return false;
  }
  const url = rawEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = rawEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return false;
  if (KNOWN_PLACEHOLDER_SERVICE_KEYS.has(serviceKey)) return false;
  return z.string().url().safeParse(url).success && serviceKey.length > 0;
}

/**
 * Retrieves validated Supabase admin credentials for server-only lifecycle operations.
 * Throws SupabaseConfigError if missing, placeholder, or accessed in browser.
 */
export function getSupabaseAdminConfig(
  rawEnv: Record<string, string | undefined> = process.env
): { url: string; serviceRoleKey: string } {
  if (typeof window !== "undefined") {
    throw new SupabaseConfigError(
      "Attempted to access Supabase admin credentials in the browser."
    );
  }

  const url = rawEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = rawEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceKey || KNOWN_PLACEHOLDER_SERVICE_KEYS.has(serviceKey)) {
    throw new SupabaseConfigError(
      "Supabase admin credentials missing or placeholder. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your server environment."
    );
  }

  const parsedUrl = z.string().url().safeParse(url);
  if (!parsedUrl.success) {
    throw new SupabaseConfigError(
      `Invalid NEXT_PUBLIC_SUPABASE_URL: ${url}. Must be a valid URL.`
    );
  }

  return { url, serviceRoleKey: serviceKey };
}

/**
 * Validated environment object for server and client contexts.
 */
export const env = {
  get server(): ServerEnv {
    if (typeof window !== "undefined") {
      throw new Error(
        "Attempted to access server-only environment variables in the browser."
      );
    }
    return validateServerEnv(process.env);
  },
  get client(): ClientEnv {
    return validateClientEnv({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  },
};
