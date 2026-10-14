import { describe, it, expect } from "vitest";
import {
  buildContentSecurityPolicy,
  getSecurityHeaders,
} from "@/lib/security";

describe("Security Headers & CSP Verification", () => {
  describe("Production Policy (isDev: false)", () => {
    const prodCsp = buildContentSecurityPolicy({ isDev: false });
    const prodHeaders = getSecurityHeaders({ isDev: false });

    it("strictly excludes 'unsafe-eval' in production CSP", () => {
      expect(prodCsp).not.toContain("'unsafe-eval'");
    });

    it("enforces least-privilege defaults and anti-clickjacking", () => {
      expect(prodCsp).toContain("default-src 'self'");
      expect(prodCsp).toContain("object-src 'none'");
      expect(prodCsp).toContain("frame-ancestors 'none'");
      expect(prodCsp).toContain("upgrade-insecure-requests");
    });

    it("includes standard HTTP hardening headers", () => {
      const headerKeys = prodHeaders.map((h) => h.key);
      expect(headerKeys).toContain("Content-Security-Policy");
      expect(headerKeys).toContain("X-Content-Type-Options");
      expect(headerKeys).toContain("X-Frame-Options");
      expect(headerKeys).toContain("Referrer-Policy");
      expect(headerKeys).toContain("Permissions-Policy");
      expect(headerKeys).toContain("Strict-Transport-Security");
    });

    it("sets X-Content-Type-Options to nosniff and X-Frame-Options to DENY", () => {
      const nosniff = prodHeaders.find((h) => h.key === "X-Content-Type-Options");
      const xFrame = prodHeaders.find((h) => h.key === "X-Frame-Options");
      expect(nosniff?.value).toBe("nosniff");
      expect(xFrame?.value).toBe("DENY");
    });

    it("includes explicit media-src allowing same-origin, blob: previews, and Supabase Storage without broad wildcards", () => {
      const directives = Object.fromEntries(
        prodCsp.split("; ").map((d) => {
          const [name, ...sources] = d.split(" ");
          return [name, sources];
        })
      );

      expect(directives["media-src"]).toBeDefined();
      expect(directives["media-src"]).toEqual([
        "'self'",
        "blob:",
        "https://*.supabase.co",
      ]);

      // Reject broad wildcards on media-src
      expect(directives["media-src"]).not.toContain("*");
      expect(directives["media-src"]).not.toContain("https:");
      expect(directives["media-src"]).not.toContain("http:");

      // Verify actual HIHA Supabase Storage signed URL hostname matches https://*.supabase.co
      const sampleSignedVideoUrl = new URL(
        "https://xkvgdnlwyirpjxtalbgr.supabase.co/storage/v1/object/sign/media/00000000-0000-0000-0000-000000000001/clip.mp4?token=eyJ..."
      );
      expect(sampleSignedVideoUrl.protocol).toBe("https:");
      expect(sampleSignedVideoUrl.hostname.endsWith(".supabase.co")).toBe(true);
    });

    it("preserves all existing script, connection, image, and framing directives without weakening", () => {
      const directives = prodCsp.split("; ");
      expect(directives).toContain("default-src 'self'");
      expect(directives).toContain("script-src 'self' 'unsafe-inline'");
      expect(directives).toContain("style-src 'self' 'unsafe-inline'");
      expect(directives).toContain("img-src 'self' blob: data: https:");
      expect(directives).toContain("media-src 'self' blob: https://*.supabase.co");
      expect(directives).toContain("font-src 'self' data:");
      expect(directives).toContain("connect-src 'self' https:");
      expect(directives).toContain("object-src 'none'");
      expect(directives).toContain("base-uri 'self'");
      expect(directives).toContain("form-action 'self'");
      expect(directives).toContain("frame-ancestors 'none'");
      expect(directives).toContain("upgrade-insecure-requests");

      const cspHeader = prodHeaders.find(
        (h) => h.key === "Content-Security-Policy"
      );
      expect(cspHeader?.value).toBe(prodCsp);
    });
  });

  describe("Development Policy (isDev: true)", () => {
    const devCsp = buildContentSecurityPolicy({ isDev: true });
    const devHeaders = getSecurityHeaders({ isDev: true });

    it("allows 'unsafe-eval' strictly for development Fast Refresh/tooling", () => {
      expect(devCsp).toContain("'unsafe-eval'");
    });

    it("allows local dev HMR websocket connections", () => {
      expect(devCsp).toContain("ws: wss:");
    });

    it("includes the same restrictive media-src directive in development", () => {
      expect(devCsp).toContain("media-src 'self' blob: https://*.supabase.co");
    });

    it("omits production-only upgrade-insecure-requests and HSTS for localhost", () => {
      expect(devCsp).not.toContain("upgrade-insecure-requests");
      const hsts = devHeaders.find((h) => h.key === "Strict-Transport-Security");
      expect(hsts).toBeUndefined();
    });
  });
});
