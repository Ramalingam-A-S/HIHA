import { describe, it, expect } from "vitest";
import {
  isSupabaseConfigured,
  getSupabaseConfig,
  SupabaseConfigError,
} from "@/lib/env";

describe("Supabase Configuration Helpers", () => {
  it("detects configuration when URL and publishable key are present", () => {
    const raw = {
      NEXT_PUBLIC_SUPABASE_URL: "https://myproject.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test123",
    };
    expect(isSupabaseConfigured(raw)).toBe(true);

    const config = getSupabaseConfig(raw);
    expect(config.url).toBe("https://myproject.supabase.co");
    expect(config.key).toBe("sb_publishable_test123");
  });

  it("detects configuration when legacy anon key is present", () => {
    const raw = {
      NEXT_PUBLIC_SUPABASE_URL: "https://myproject.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_test123",
    };
    expect(isSupabaseConfigured(raw)).toBe(true);

    const config = getSupabaseConfig(raw);
    expect(config.key).toBe("anon_test123");
  });

  it("returns false when URL or key is missing", () => {
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://myproject.supabase.co",
      })
    ).toBe(false);

    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_key",
      })
    ).toBe(false);

    expect(isSupabaseConfigured({})).toBe(false);
  });

  it("throws SupabaseConfigError with helpful message when required vars missing", () => {
    expect(() => getSupabaseConfig({})).toThrowError(SupabaseConfigError);
    expect(() => getSupabaseConfig({})).toThrowError(/Supabase credentials missing/);
  });

  it("throws SupabaseConfigError when URL is invalid", () => {
    expect(() =>
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-valid-url",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      })
    ).toThrowError(SupabaseConfigError);
  });
});
