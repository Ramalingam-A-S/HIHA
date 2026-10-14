import { describe, it, expect } from "vitest";
import {
  signUpSchema,
  loginSchema,
  resetPasswordSchema,
} from "@/lib/validations/auth";

describe("Authentication Validation Schemas", () => {
  describe("signUpSchema", () => {
    it("accepts valid sign up inputs", () => {
      const valid = {
        email: "user@example.com",
        password: "securePassword123",
        username: "responsible_user",
        displayName: "Responsible User",
      };
      const result = signUpSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.username).toBe("responsible_user");
        expect(result.data.email).toBe("user@example.com");
      }
    });

    it("lowercases email and username automatically", () => {
      const input = {
        email: "ALICE@EXAMPLE.COM",
        password: "securePassword123",
        username: "ALICE_DOE",
        displayName: "Alice Doe",
      };
      const result = signUpSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("alice@example.com");
        expect(result.data.username).toBe("alice_doe");
      }
    });

    it("rejects password shorter than 8 characters", () => {
      const result = signUpSchema.safeParse({
        email: "user@example.com",
        password: "short",
        username: "valid_user",
        displayName: "Valid User",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.password).toBeDefined();
      }
    });

    it("rejects usernames with spaces or special characters", () => {
      const invalidUsernames = [
        "user name",
        "user!name",
        "user@name",
        "us", // too short (<3)
        "a".repeat(31), // too long (>30)
      ];

      invalidUsernames.forEach((username) => {
        const result = signUpSchema.safeParse({
          email: "user@example.com",
          password: "securePassword123",
          username,
          displayName: "Test User",
        });
        expect(result.success).toBe(false);
      });
    });

    it("rejects blank or oversized display names", () => {
      const emptyResult = signUpSchema.safeParse({
        email: "user@example.com",
        password: "securePassword123",
        username: "valid_user",
        displayName: "   ",
      });
      expect(emptyResult.success).toBe(false);

      const longResult = signUpSchema.safeParse({
        email: "user@example.com",
        password: "securePassword123",
        username: "valid_user",
        displayName: "A".repeat(61),
      });
      expect(longResult.success).toBe(false);
    });
  });

  describe("loginSchema", () => {
    it("accepts valid login inputs", () => {
      const result = loginSchema.safeParse({
        email: "user@example.com",
        password: "password123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty password or invalid email", () => {
      const invalidEmail = loginSchema.safeParse({
        email: "not-an-email",
        password: "password123",
      });
      expect(invalidEmail.success).toBe(false);

      const emptyPassword = loginSchema.safeParse({
        email: "user@example.com",
        password: "",
      });
      expect(emptyPassword.success).toBe(false);
    });
  });

  describe("resetPasswordSchema", () => {
    it("validates well-formed email addresses", () => {
      expect(
        resetPasswordSchema.safeParse({ email: "valid@example.com" }).success
      ).toBe(true);
      expect(
        resetPasswordSchema.safeParse({ email: "invalid-email" }).success
      ).toBe(false);
    });
  });
});
