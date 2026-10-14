import { describe, it, expect } from "vitest";
import {
  validateServerEnv,
  validateClientEnv,
  serverEnvSchema,
  clientEnvSchema,
} from "@/lib/env";

describe("Environment Variable Validation", () => {
  describe("validateServerEnv", () => {
    it("validates valid server environment variables with defaults", () => {
      const parsed = validateServerEnv({
        NODE_ENV: "production",
        PORT: "4000",
        DATABASE_URL: "https://db.example.com",
      });

      expect(parsed.NODE_ENV).toBe("production");
      expect(parsed.PORT).toBe(4000);
      expect(parsed.DATABASE_URL).toBe("https://db.example.com");
    });

    it("applies default NODE_ENV when not specified", () => {
      const parsed = validateServerEnv({});
      expect(parsed.NODE_ENV).toBe("development");
    });

    it("throws a descriptive error when NODE_ENV is invalid", () => {
      expect(() =>
        validateServerEnv({
          NODE_ENV: "staging-invalid",
        })
      ).toThrowError(/Invalid server environment variables/);
    });

    it("throws an error when DATABASE_URL is not a valid URL", () => {
      expect(() =>
        validateServerEnv({
          DATABASE_URL: "not-a-valid-url",
        })
      ).toThrowError(/Invalid server environment variables/);
    });
  });

  describe("validateClientEnv", () => {
    it("validates valid client environment variables with defaults", () => {
      const parsed = validateClientEnv({
        NEXT_PUBLIC_APP_URL: "https://myplatform.app",
        NEXT_PUBLIC_SUPABASE_URL: "https://xyz.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-12345",
      });

      expect(parsed.NEXT_PUBLIC_APP_URL).toBe("https://myplatform.app");
      expect(parsed.NEXT_PUBLIC_SUPABASE_URL).toBe("https://xyz.supabase.co");
      expect(parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-key-12345");
    });

    it("applies default NEXT_PUBLIC_APP_URL when empty", () => {
      const parsed = validateClientEnv({});
      expect(parsed.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    });

    it("throws an error when NEXT_PUBLIC_APP_URL is not a valid URL", () => {
      expect(() =>
        validateClientEnv({
          NEXT_PUBLIC_APP_URL: "bad-url",
        })
      ).toThrowError(/Invalid client environment variables/);
    });
  });

  describe("Security schema checks", () => {
    it("does not include service-role keys in client schema", () => {
      const clientKeys = Object.keys(clientEnvSchema.shape);
      expect(clientKeys).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(
        clientKeys.every((key) => key.startsWith("NEXT_PUBLIC_"))
      ).toBe(true);
    });

    it("server schema does not require Supabase credentials for basic scaffold", () => {
      const result = serverEnvSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("Supabase Admin Environment Validation", () => {
    it("recognizes configured admin credentials when valid url and non-placeholder key are provided", async () => {
      const { isSupabaseAdminConfigured, getSupabaseAdminConfig } = await import("@/lib/env");
      const validEnv = {
        NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "secret-service-role-key-99999",
      };

      expect(isSupabaseAdminConfigured(validEnv)).toBe(true);
      const config = getSupabaseAdminConfig(validEnv);
      expect(config.url).toBe("https://test-project.supabase.co");
      expect(config.serviceRoleKey).toBe("secret-service-role-key-99999");
    });

    it("rejects placeholder and missing service role keys", async () => {
      const { isSupabaseAdminConfigured, getSupabaseAdminConfig, SupabaseConfigError } = await import("@/lib/env");

      // Missing key
      expect(
        isSupabaseAdminConfigured({
          NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
        })
      ).toBe(false);

      expect(() =>
        getSupabaseAdminConfig({
          NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
        })
      ).toThrowError(SupabaseConfigError);

      // Known placeholder key
      expect(
        isSupabaseAdminConfigured({
          NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key-do-not-expose-to-browser",
        })
      ).toBe(false);

      expect(() =>
        getSupabaseAdminConfig({
          NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key-do-not-expose-to-browser",
        })
      ).toThrowError(/missing or placeholder/);
    });
  });

  describe("resolveSiteUrl", () => {
    it("respects explicit NEXT_PUBLIC_SITE_URL as highest priority", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      const resolved = resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://custom-site.com",
        NEXT_PUBLIC_APP_URL: "https://custom-app.com",
        VERCEL_URL: "preview.vercel.app",
        NODE_ENV: "production",
      });
      expect(resolved).toBe("https://custom-site.com");
    });

    it("strips trailing slashes from explicit NEXT_PUBLIC_SITE_URL", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      const resolved = resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://custom-site.com///",
        NODE_ENV: "production",
      });
      expect(resolved).toBe("https://custom-site.com");
    });

    it("respects explicit NEXT_PUBLIC_APP_URL when NEXT_PUBLIC_SITE_URL is omitted", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      const resolved = resolveSiteUrl({
        NEXT_PUBLIC_APP_URL: "https://app-domain.org",
        VERCEL_URL: "preview.vercel.app",
        NODE_ENV: "production",
      });
      expect(resolved).toBe("https://app-domain.org");
    });

    it("resolves Vercel Preview URL when explicit site and app URLs are omitted", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      const resolved = resolveSiteUrl({
        VERCEL_URL: "hiha-git-preview-123.vercel.app",
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      });
      expect(resolved).toBe("https://hiha-git-preview-123.vercel.app");
    });

    it("handles VERCEL_URL that already includes https protocol", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      const resolved = resolveSiteUrl({
        VERCEL_URL: "https://hiha-git-preview-123.vercel.app",
        NODE_ENV: "production",
      });
      expect(resolved).toBe("https://hiha-git-preview-123.vercel.app");
    });

    it("falls back to VERCEL_URL in production when NEXT_PUBLIC_APP_URL is localhost", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      const resolved = resolveSiteUrl({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        VERCEL_URL: "hiha-git-preview-123.vercel.app",
        NODE_ENV: "production",
      });
      expect(resolved).toBe("https://hiha-git-preview-123.vercel.app");
    });

    it("falls back to http://localhost:3000 in local development environment", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      const resolvedDev = resolveSiteUrl({
        NODE_ENV: "development",
      });
      expect(resolvedDev).toBe("http://localhost:3000");

      const resolvedTest = resolveSiteUrl({
        NODE_ENV: "test",
      });
      expect(resolvedTest).toBe("http://localhost:3000");

      const resolvedEmpty = resolveSiteUrl({});
      expect(resolvedEmpty).toBe("http://localhost:3000");
    });

    it("throws SiteUrlConfigError in production when all configuration is missing", async () => {
      const { resolveSiteUrl, SiteUrlConfigError } = await import("@/lib/env");
      expect(() =>
        resolveSiteUrl({
          NODE_ENV: "production",
        })
      ).toThrowError(SiteUrlConfigError);

      expect(() =>
        resolveSiteUrl({
          NODE_ENV: "production",
        })
      ).toThrowError(/Site URL configuration is missing in production/);
    });

    it("throws SiteUrlConfigError in production when only localhost is provided and no Vercel URL exists", async () => {
      const { resolveSiteUrl } = await import("@/lib/env");
      expect(() =>
        resolveSiteUrl({
          NODE_ENV: "production",
          NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        })
      ).toThrowError(/Production environment cannot use a localhost site URL/);

      expect(() =>
        resolveSiteUrl({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
        })
      ).toThrowError(/Production environment cannot use a localhost app URL/);
    });

    it("throws SiteUrlConfigError when candidate URL is malformed", async () => {
      const { resolveSiteUrl, SiteUrlConfigError } = await import("@/lib/env");
      expect(() =>
        resolveSiteUrl({
          NEXT_PUBLIC_SITE_URL: "not-a-valid-url",
          NODE_ENV: "development",
        })
      ).toThrowError(SiteUrlConfigError);
    });
  });
});
