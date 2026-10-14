import { describe, it, expect } from "vitest";
import { cn, truncate, slugify } from "@/lib/utils";

describe("Utility functions", () => {
  describe("cn", () => {
    it("joins valid class names and ignores falsy values", () => {
      const result = cn("btn", false, undefined, "btn-primary", null, "active");
      expect(result).toBe("btn btn-primary active");
    });

    it("returns an empty string if all inputs are falsy", () => {
      expect(cn(false, undefined, null)).toBe("");
    });
  });

  describe("truncate", () => {
    it("leaves text unchanged if below maxLength", () => {
      expect(truncate("Short text", 20)).toBe("Short text");
    });

    it("truncates at word boundary with ellipsis", () => {
      expect(truncate("Responsible social media discovery", 20)).toBe(
        "Responsible social..."
      );
    });
  });

  describe("slugify", () => {
    it("converts strings to clean URL slugs", () => {
      expect(slugify("Digital Well-Being & Privacy")).toBe(
        "digital-well-being-privacy"
      );
    });

    it("handles extraneous spaces and dashes", () => {
      expect(slugify("  --Tech & Society--  ")).toBe("tech-society");
    });
  });
});
