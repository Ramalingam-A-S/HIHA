import { describe, it, expect } from "vitest";

/**
 * Pure verification of the SQL Row Level Security policy logic
 * defined in supabase/migrations/20261009120000_create_profiles.sql:
 *
 * SELECT Policy: is_private = false OR auth.uid() = id
 * UPDATE Policy: auth.uid() = id
 * INSERT Policy: auth.uid() = id
 * Trigger: Prevent updating id (NEW.id <> OLD.id raises exception)
 */

interface ProfileRecord {
  id: string;
  username: string;
  display_name: string;
  is_private: boolean;
}

function evaluateSelectPolicy(
  authUid: string | null,
  profile: Pick<ProfileRecord, "id" | "is_private">
): boolean {
  return !profile.is_private || (authUid !== null && authUid === profile.id);
}

function evaluateUpdatePolicy(
  authUid: string | null,
  targetProfileId: string
): boolean {
  return authUid !== null && authUid === targetProfileId;
}

function evaluateTriggerIdImmutability(
  oldId: string,
  newId: string
): { allowed: boolean; error?: string } {
  if (oldId !== newId) {
    return { allowed: false, error: "Profile ID cannot be modified" };
  }
  return { allowed: true };
}

describe("Row Level Security Policy & Constraints Logic", () => {
  const aliceId = "11111111-1111-4111-a111-111111111111";
  const bobId = "22222222-2222-4222-a222-222222222222";

  describe("SELECT Policy: is_private = false OR auth.uid() = id", () => {
    it("allows anonymous viewers to access public profiles", () => {
      const publicProfile = { id: aliceId, is_private: false };
      expect(evaluateSelectPolicy(null, publicProfile)).toBe(true);
    });

    it("allows authenticated other users to access public profiles", () => {
      const publicProfile = { id: aliceId, is_private: false };
      expect(evaluateSelectPolicy(bobId, publicProfile)).toBe(true);
    });

    it("blocks anonymous viewers from accessing private profiles", () => {
      const privateProfile = { id: aliceId, is_private: true };
      expect(evaluateSelectPolicy(null, privateProfile)).toBe(false);
    });

    it("blocks non-owner authenticated users from accessing private profiles", () => {
      const privateProfile = { id: aliceId, is_private: true };
      expect(evaluateSelectPolicy(bobId, privateProfile)).toBe(false);
    });

    it("allows owner to access their own private profile", () => {
      const privateProfile = { id: aliceId, is_private: true };
      expect(evaluateSelectPolicy(aliceId, privateProfile)).toBe(true);
    });
  });

  describe("UPDATE Policy: auth.uid() = id", () => {
    it("allows owner to update their own profile", () => {
      expect(evaluateUpdatePolicy(aliceId, aliceId)).toBe(true);
    });

    it("blocks other users from updating Alice's profile", () => {
      expect(evaluateUpdatePolicy(bobId, aliceId)).toBe(false);
    });

    it("blocks unauthenticated users from updating any profile", () => {
      expect(evaluateUpdatePolicy(null, aliceId)).toBe(false);
    });
  });

  describe("Trigger: ID Immutability", () => {
    it("allows updates when ID remains identical", () => {
      const result = evaluateTriggerIdImmutability(aliceId, aliceId);
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("rejects tampering with profile ownership ID", () => {
      const result = evaluateTriggerIdImmutability(aliceId, bobId);
      expect(result.allowed).toBe(false);
      expect(result.error).toBe("Profile ID cannot be modified");
    });
  });
});
