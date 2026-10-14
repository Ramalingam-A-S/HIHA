import { describe, it, expect } from "vitest";
import {
  createCommunitySchema,
  communityQuerySchema,
  COMMUNITY_VISIBILITIES,
  COMMUNITY_ROLES,
  COMMUNITY_STATUSES,
  SLUG_REGEX,
  type CommunityRole,
  type CommunityStatus,
  type CommunityVisibility,
} from "@/lib/communities/types";

describe("Communities Foundation Logic & Validation", () => {
  describe("Zod createCommunitySchema Validation", () => {
    it("accepts a valid public community payload", () => {
      const payload = {
        name: "Generative AI Researchers",
        slug: "genai-researchers",
        description: "A hub for LLM architecture and safety discussions.",
        visibility: "public" as const,
        category: "Technology",
      };
      const res = createCommunitySchema.safeParse(payload);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Generative AI Researchers");
        expect(res.data.slug).toBe("genai-researchers");
        expect(res.data.visibility).toBe("public");
      }
    });

    it("accepts a valid private community payload", () => {
      const payload = {
        name: "Private Founders Circle",
        slug: "founders-circle",
        visibility: "private" as const,
      };
      const res = createCommunitySchema.safeParse(payload);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.visibility).toBe("private");
        expect(res.data.description).toBeUndefined();
      }
    });

    it("enforces default visibility to 'public' when omitted", () => {
      const payload = {
        name: "Public Club",
        slug: "public-club",
      };
      const res = createCommunitySchema.safeParse(payload);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.visibility).toBe("public");
      }
    });

    it("rejects invalid slugs with spaces, uppercase, or special characters", () => {
      expect(SLUG_REGEX.test("invalid slug")).toBe(false);
      expect(SLUG_REGEX.test("InvalidSlug")).toBe(false);
      expect(SLUG_REGEX.test("invalid_slug")).toBe(false);
      expect(SLUG_REGEX.test("-leading-hyphen")).toBe(false);
      expect(SLUG_REGEX.test("trailing-hyphen-")).toBe(false);
      expect(SLUG_REGEX.test("double--hyphen")).toBe(false);
      expect(SLUG_REGEX.test("special!char")).toBe(false);

      expect(
        createCommunitySchema.safeParse({
          name: "Invalid Community",
          slug: "invalid slug with spaces",
        }).success
      ).toBe(false);
    });

    it("accepts valid alphanumeric hypenated slugs", () => {
      expect(SLUG_REGEX.test("tech")).toBe(true);
      expect(SLUG_REGEX.test("ai-2026")).toBe(true);
      expect(SLUG_REGEX.test("deep-learning-lab")).toBe(true);
    });

    it("rejects names and slugs that are too short or too long", () => {
      // Too short
      expect(
        createCommunitySchema.safeParse({
          name: "A",
          slug: "ab",
        }).success
      ).toBe(false);

      expect(
        createCommunitySchema.safeParse({
          name: "Valid Name",
          slug: "a",
        }).success
      ).toBe(false);

      // Too long (> 100 chars name, > 50 chars slug)
      expect(
        createCommunitySchema.safeParse({
          name: "A".repeat(101),
          slug: "valid-slug",
        }).success
      ).toBe(false);

      expect(
        createCommunitySchema.safeParse({
          name: "Valid Name",
          slug: "a".repeat(51),
        }).success
      ).toBe(false);
    });

    it("validates optional UUID interestId format", () => {
      expect(
        createCommunitySchema.safeParse({
          name: "Valid Name",
          slug: "valid-slug",
          interestId: "not-a-uuid",
        }).success
      ).toBe(false);

      expect(
        createCommunitySchema.safeParse({
          name: "Valid Name",
          slug: "valid-slug",
          interestId: "a0000000-0000-4000-8000-000000000001",
        }).success
      ).toBe(true);
    });
  });

  describe("Zod communityQuerySchema Validation", () => {
    it("applies default pagination parameters", () => {
      const res = communityQuerySchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(1);
        expect(res.data.pageSize).toBe(20);
      }
    });

    it("enforces maximum pageSize limit of 50 to prevent unbounded queries", () => {
      expect(communityQuerySchema.safeParse({ pageSize: 50 }).success).toBe(true);
      expect(communityQuerySchema.safeParse({ pageSize: 51 }).success).toBe(false);
      expect(communityQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
    });
  });

  describe("Community Role & Status Constants", () => {
    it("defines valid community visibilities", () => {
      expect(COMMUNITY_VISIBILITIES).toEqual(["public", "private"]);
    });

    it("defines valid community roles", () => {
      expect(COMMUNITY_ROLES).toEqual(["owner", "moderator", "member"]);
    });

    it("defines valid community statuses", () => {
      expect(COMMUNITY_STATUSES).toEqual(["active", "pending", "rejected", "banned"]);
    });
  });

  describe("Community Invariants & State Transition Rules", () => {
    // Pure logic simulation of community membership state transitions
    interface MemberState {
      userId: string;
      role: CommunityRole;
      status: CommunityStatus;
    }

    function evaluateJoinCommunity(
      visibility: CommunityVisibility,
      userId: string,
      existing: MemberState | null
    ): { allowed: boolean; newStatus?: CommunityStatus; role?: CommunityRole; reason?: string } {
      if (existing) {
        if (existing.status === "banned") {
          return { allowed: false, reason: "Banned user cannot join" };
        }
        if (existing.status === "active") {
          return { allowed: false, reason: "Already an active member" };
        }
        if (existing.status === "pending") {
          return { allowed: false, reason: "Join request already pending" };
        }
      }

      if (visibility === "public") {
        return { allowed: true, newStatus: "active", role: "member" };
      } else {
        return { allowed: true, newStatus: "pending", role: "member" };
      }
    }

    function evaluateLeaveCommunity(
      member: MemberState
    ): { allowed: boolean; reason?: string } {
      if (member.role === "owner") {
        return {
          allowed: false,
          reason: "Owner cannot leave community without transferring ownership first",
        };
      }
      return { allowed: true };
    }

    function evaluateTransferOwnership(
      actorRole: CommunityRole,
      targetMember: MemberState
    ): {
      allowed: boolean;
      newActorRole?: CommunityRole;
      newTargetRole?: CommunityRole;
      reason?: string;
    } {
      if (actorRole !== "owner") {
        return { allowed: false, reason: "Only current owner can transfer ownership" };
      }
      if (targetMember.status !== "active") {
        return { allowed: false, reason: "Target must be an active member" };
      }
      return {
        allowed: true,
        newActorRole: "moderator",
        newTargetRole: "owner",
      };
    }

    function evaluateRoleUpdate(
      actorRole: CommunityRole,
      targetMember: MemberState,
      newRole: "moderator" | "member"
    ): { allowed: boolean; reason?: string } {
      if (actorRole !== "owner") {
        return { allowed: false, reason: "Only owner can change staff roles" };
      }
      if (targetMember.role === "owner") {
        return { allowed: false, reason: "Cannot change owner role directly" };
      }
      if (!["moderator", "member"].includes(newRole)) {
        return { allowed: false, reason: "Invalid role specified" };
      }
      return { allowed: true };
    }

    it("allows direct join with status 'active' for public community", () => {
      const res = evaluateJoinCommunity("public", "user-2", null);
      expect(res.allowed).toBe(true);
      expect(res.newStatus).toBe("active");
      expect(res.role).toBe("member");
    });

    it("places user into 'pending' status for private community", () => {
      const res = evaluateJoinCommunity("private", "user-2", null);
      expect(res.allowed).toBe(true);
      expect(res.newStatus).toBe("pending");
      expect(res.role).toBe("member");
    });

    it("prevents banned user from re-joining", () => {
      const res = evaluateJoinCommunity("public", "user-2", {
        userId: "user-2",
        role: "member",
        status: "banned",
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe("Banned user cannot join");
    });

    it("strictly prohibits owner from leaving without transferring ownership", () => {
      const ownerMember: MemberState = {
        userId: "user-owner",
        role: "owner",
        status: "active",
      };
      const res = evaluateLeaveCommunity(ownerMember);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Owner cannot leave");
    });

    it("allows standard member to leave freely", () => {
      const regMember: MemberState = {
        userId: "user-reg",
        role: "member",
        status: "active",
      };
      const res = evaluateLeaveCommunity(regMember);
      expect(res.allowed).toBe(true);
    });

    it("allows owner to transfer ownership safely, demoting self to moderator", () => {
      const targetMember: MemberState = {
        userId: "user-mod",
        role: "moderator",
        status: "active",
      };
      const res = evaluateTransferOwnership("owner", targetMember);
      expect(res.allowed).toBe(true);
      expect(res.newActorRole).toBe("moderator");
      expect(res.newTargetRole).toBe("owner");
    });

    it("rejects non-owner attempts to transfer ownership", () => {
      const targetMember: MemberState = {
        userId: "user-mod",
        role: "moderator",
        status: "active",
      };
      const res = evaluateTransferOwnership("moderator", targetMember);
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe("Only current owner can transfer ownership");
    });

    it("allows owner to promote member to moderator and demote moderator to member", () => {
      const target: MemberState = {
        userId: "user-regular",
        role: "member",
        status: "active",
      };
      expect(evaluateRoleUpdate("owner", target, "moderator").allowed).toBe(true);

      const targetMod: MemberState = {
        userId: "user-regular",
        role: "moderator",
        status: "active",
      };
      expect(evaluateRoleUpdate("owner", targetMod, "member").allowed).toBe(true);
    });

    it("prevents non-owners from modifying member roles", () => {
      const target: MemberState = {
        userId: "user-regular",
        role: "member",
        status: "active",
      };
      expect(evaluateRoleUpdate("moderator", target, "moderator").allowed).toBe(false);
      expect(evaluateRoleUpdate("member", target, "moderator").allowed).toBe(false);
    });
  });
});
