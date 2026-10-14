import { describe, it, expect } from "vitest";
import {
  targetUserSchema,
  followResponseSchema,
} from "@/lib/validations/relationships";

describe("Social Graph Relationship Logic & Validation", () => {
  describe("Zod Validation Schemas", () => {
    it("accepts valid UUID for target user", () => {
      const valid = { targetUserId: "123e4567-e89b-12d3-a456-426614174000" };
      const res = targetUserSchema.safeParse(valid);
      expect(res.success).toBe(true);
    });

    it("rejects malformed target user UUID", () => {
      const invalid = { targetUserId: "not-a-valid-uuid" };
      const res = targetUserSchema.safeParse(invalid);
      expect(res.success).toBe(false);
    });

    it("accepts valid response actions 'accept' and 'reject'", () => {
      const acceptRes = followResponseSchema.safeParse({
        followId: "123e4567-e89b-12d3-a456-426614174000",
        action: "accept",
      });
      const rejectRes = followResponseSchema.safeParse({
        followId: "123e4567-e89b-12d3-a456-426614174000",
        action: "reject",
      });
      expect(acceptRes.success).toBe(true);
      expect(rejectRes.success).toBe(true);
    });

    it("rejects unauthorized actions in follow responses", () => {
      const invalid = followResponseSchema.safeParse({
        followId: "123e4567-e89b-12d3-a456-426614174000",
        action: "delete_account",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Social Relationship Invariants", () => {
    // Pure model helper representing the PostgreSQL RLS profile visibility logic
    function isProfileVisible(
      callerId: string | null,
      targetProfile: { id: string; is_private: boolean },
      relationships: {
        follows: Array<{ follower_id: string; following_id: string; status: "pending" | "accepted" }>;
        blocks: Array<{ blocker_id: string; blocked_id: string }>;
      }
    ): boolean {
      // 1. Owner always sees their own profile
      if (callerId && callerId === targetProfile.id) {
        return true;
      }

      // 2. Block check: if target blocked caller, profile is invisible
      if (callerId) {
        const isBlockedByTarget = relationships.blocks.some(
          (b) => b.blocker_id === targetProfile.id && b.blocked_id === callerId
        );
        if (isBlockedByTarget) {
          return false;
        }
      }

      // 3. Public profiles are visible
      if (!targetProfile.is_private) {
        return true;
      }

      // 4. Private profiles are visible only to accepted followers
      if (callerId) {
        const hasAcceptedFollow = relationships.follows.some(
          (f) =>
            f.follower_id === callerId &&
            f.following_id === targetProfile.id &&
            f.status === "accepted"
        );
        return hasAcceptedFollow;
      }

      return false;
    }

    const userA = "user-a";
    const userB = "user-b";
    const userC = "user-c";

    it("allows anyone to view public profiles when not blocked", () => {
      const publicProfile = { id: userB, is_private: false };
      const rels = { follows: [], blocks: [] };

      expect(isProfileVisible(userA, publicProfile, rels)).toBe(true);
      expect(isProfileVisible(null, publicProfile, rels)).toBe(true); // Anonymous
    });

    it("hides public profile from a user who has been blocked by the owner", () => {
      const publicProfile = { id: userB, is_private: false };
      const rels = {
        follows: [],
        blocks: [{ blocker_id: userB, blocked_id: userA }],
      };

      // User A is blocked by User B
      expect(isProfileVisible(userA, publicProfile, rels)).toBe(false);
      // Other unblocked users can still view it
      expect(isProfileVisible(userC, publicProfile, rels)).toBe(true);
    });

    it("hides private profile from non-followers and pending requesters", () => {
      const privateProfile = { id: userB, is_private: true };
      const nonFollowerRels = { follows: [], blocks: [] };
      const pendingRels = {
        follows: [
          { follower_id: userA, following_id: userB, status: "pending" as const },
        ],
        blocks: [],
      };

      expect(isProfileVisible(userA, privateProfile, nonFollowerRels)).toBe(false);
      expect(isProfileVisible(userA, privateProfile, pendingRels)).toBe(false);
    });

    it("allows accepted followers to view private profiles", () => {
      const privateProfile = { id: userB, is_private: true };
      const acceptedRels = {
        follows: [
          { follower_id: userA, following_id: userB, status: "accepted" as const },
        ],
        blocks: [],
      };

      expect(isProfileVisible(userA, privateProfile, acceptedRels)).toBe(true);
    });

    it("ensures blocking strictly overrides an existing accepted follow", () => {
      const privateProfile = { id: userB, is_private: true };
      const blockedAndFollowedRels = {
        follows: [
          { follower_id: userA, following_id: userB, status: "accepted" as const },
        ],
        blocks: [{ blocker_id: userB, blocked_id: userA }],
      };

      // Even though User A has an accepted follow record, User B's block overrides it
      expect(isProfileVisible(userA, privateProfile, blockedAndFollowedRels)).toBe(false);
    });

    it("always permits the account owner to view their own profile", () => {
      const privateProfile = { id: userA, is_private: true };
      const rels = { follows: [], blocks: [] };

      expect(isProfileVisible(userA, privateProfile, rels)).toBe(true);
    });
  });
});
