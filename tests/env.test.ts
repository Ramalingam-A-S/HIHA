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
});
