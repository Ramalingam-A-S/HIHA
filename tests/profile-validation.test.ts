import { describe, it, expect } from "vitest";
import { updateProfileSchema } from "@/lib/validations/profile";

describe("Profile Validation Schema", () => {
  it("accepts valid profile updates", () => {
    const valid = {
      displayName: "Jane Doe",
      bio: "Learning systems architecture and UI design.",
      isPrivate: true,
    };
    const result = updateProfileSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("Jane Doe");
      expect(result.data.isPrivate).toBe(true);
      expect(result.data.bio).toBe(
        "Learning systems architecture and UI design."
      );
    }
  });

  it("transforms empty string bio to null", () => {
    const input = {
      displayName: "Jane Doe",
      bio: "",
      isPrivate: false,
    };
    const result = updateProfileSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bio).toBeNull();
    }
  });

  it("rejects bio exceeding 500 characters", () => {
    const oversizedBio = "A".repeat(501);
    const result = updateProfileSchema.safeParse({
      displayName: "Jane Doe",
      bio: oversizedBio,
      isPrivate: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty or whitespace-only display name", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "   ",
      bio: null,
      isPrivate: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects display name exceeding 60 characters", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "B".repeat(61),
      bio: null,
      isPrivate: false,
    });
    expect(result.success).toBe(false);
  });
});
