import { describe, it, expect } from "vitest";
import {
  customInterestSchema,
  saveUserInterestsSchema,
  slugifyInterest,
} from "@/lib/validations/interests";

describe("Interests Validation & Normalization", () => {
  describe("slugifyInterest", () => {
    it("converts mixed case and spaces to lowercase hyphenated slugs", () => {
      expect(slugifyInterest("Artificial Intelligence")).toBe("artificial-intelligence");
      expect(slugifyInterest("  Quantum  Computing  ")).toBe("quantum-computing");
    });

    it("strips special characters and punctuation", () => {
      expect(slugifyInterest("AI & Machine Learning (2026)!")).toBe("ai-machine-learning-2026");
    });

    it("caps slug length at 60 characters", () => {
      const longName = "A".repeat(100);
      const slug = slugifyInterest(longName);
      expect(slug.length).toBeLessThanOrEqual(60);
    });
  });

  describe("customInterestSchema", () => {
    it("accepts valid custom interest data", () => {
      const valid = {
        name: "Renewable Microgrids",
        category: "technology-science",
        description: "Decentralized energy and solar storage.",
      };
      const result = customInterestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects names shorter than 2 characters", () => {
      const result = customInterestSchema.safeParse({
        name: "A",
        category: "technology-science",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.name).toBeDefined();
      }
    });

    it("rejects invalid categories outside defined taxonomy", () => {
      const result = customInterestSchema.safeParse({
        name: "Crypto Trading",
        category: "unauthorized-category",
      });
      expect(result.success).toBe(false);
    });

    it("rejects descriptions exceeding 250 characters", () => {
      const result = customInterestSchema.safeParse({
        name: "Valid Name",
        category: "art-design",
        description: "D".repeat(251),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("saveUserInterestsSchema", () => {
    it("accepts valid array of interest IDs and priorities between 1 and 5", () => {
      const result = saveUserInterestsSchema.safeParse({
        interests: [
          { interestId: "123e4567-e89b-12d3-a456-426614174000", priority: 5 },
          { interestId: "987fcdeb-51a2-43f7-9876-543210987654", priority: 1 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects priorities outside the 1..5 range", () => {
      const lowResult = saveUserInterestsSchema.safeParse({
        interests: [{ interestId: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", priority: 0 }],
      });
      expect(lowResult.success).toBe(false);

      const highResult = saveUserInterestsSchema.safeParse({
        interests: [{ interestId: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", priority: 6 }],
      });
      expect(highResult.success).toBe(false);
    });

    it("rejects malformed UUIDs", () => {
      const result = saveUserInterestsSchema.safeParse({
        interests: [{ interestId: "not-a-uuid", priority: 3 }],
      });
      expect(result.success).toBe(false);
    });
  });
});
