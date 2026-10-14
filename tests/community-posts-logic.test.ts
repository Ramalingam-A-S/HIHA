import { describe, it, expect } from "vitest";

describe("Community Posts, Discussions & Scoped Moderation Logic", () => {
  describe("Post Sharing Eligibility Invariants", () => {
    interface MemberState {
      status: "active" | "pending" | "rejected" | "banned";
      role: "owner" | "moderator" | "member";
    }

    interface PostState {
      creator_id: string;
      status: "draft" | "published";
    }

    function canShareToCommunity(
      member: MemberState | null,
      post: PostState,
      callerId: string
    ): { allowed: boolean; reason?: string } {
      if (!member || member.status !== "active") {
        return { allowed: false, reason: "Must be an active community member." };
      }
      if (post.creator_id !== callerId) {
        return { allowed: false, reason: "Only the author may share their post." };
      }
      if (post.status !== "published") {
        return { allowed: false, reason: "Only published posts may be shared." };
      }
      return { allowed: true };
    }

    it("allows active member to share their published post", () => {
      const member: MemberState = { status: "active", role: "member" };
      const post: PostState = { creator_id: "user-1", status: "published" };
      const result = canShareToCommunity(member, post, "user-1");
      expect(result.allowed).toBe(true);
    });

    it("prevents non-members from sharing posts", () => {
      const post: PostState = { creator_id: "user-1", status: "published" };
      const result = canShareToCommunity(null, post, "user-1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Must be an active community member.");
    });

    it("prevents pending membership applicants from sharing posts", () => {
      const member: MemberState = { status: "pending", role: "member" };
      const post: PostState = { creator_id: "user-1", status: "published" };
      const result = canShareToCommunity(member, post, "user-1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Must be an active community member.");
    });

    it("prevents banned members from sharing posts", () => {
      const member: MemberState = { status: "banned", role: "member" };
      const post: PostState = { creator_id: "user-1", status: "published" };
      const result = canShareToCommunity(member, post, "user-1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Must be an active community member.");
    });

    it("prevents sharing draft posts", () => {
      const member: MemberState = { status: "active", role: "member" };
      const post: PostState = { creator_id: "user-1", status: "draft" };
      const result = canShareToCommunity(member, post, "user-1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Only published posts may be shared.");
    });

    it("prevents users from sharing posts created by other users", () => {
      const member: MemberState = { status: "active", role: "member" };
      const post: PostState = { creator_id: "user-other", status: "published" };
      const result = canShareToCommunity(member, post, "user-1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Only the author may share their post.");
    });
  });

  describe("Scoped Moderation & Pinning Invariants", () => {
    type Role = "owner" | "moderator" | "member";

    function canPinPost(role: Role): boolean {
      return role === "owner" || role === "moderator";
    }

    function canRemovePost(
      callerRole: Role,
      callerId: string,
      posterId: string
    ): { allowed: boolean; method: "hard_delete" | "soft_removal" | "denied" } {
      if (callerId === posterId) {
        return { allowed: true, method: "hard_delete" };
      }
      if (callerRole === "owner" || callerRole === "moderator") {
        return { allowed: true, method: "soft_removal" };
      }
      return { allowed: false, method: "denied" };
    }

    it("allows community owner to pin posts", () => {
      expect(canPinPost("owner")).toBe(true);
    });

    it("allows community moderator to pin posts", () => {
      expect(canPinPost("moderator")).toBe(true);
    });

    it("denies ordinary members from pinning posts", () => {
      expect(canPinPost("member")).toBe(false);
    });

    it("allows post author to retract their own post via hard delete", () => {
      const res = canRemovePost("member", "author-1", "author-1");
      expect(res.allowed).toBe(true);
      expect(res.method).toBe("hard_delete");
    });

    it("allows moderators to remove non-authored posts via soft removal", () => {
      const res = canRemovePost("moderator", "mod-1", "author-1");
      expect(res.allowed).toBe(true);
      expect(res.method).toBe("soft_removal");
    });

    it("allows community owners to remove non-authored posts via soft removal", () => {
      const res = canRemovePost("owner", "owner-1", "author-1");
      expect(res.allowed).toBe(true);
      expect(res.method).toBe("soft_removal");
    });

    it("denies ordinary members from removing posts authored by others", () => {
      const res = canRemovePost("member", "other-member", "author-1");
      expect(res.allowed).toBe(false);
      expect(res.method).toBe("denied");
    });
  });

  describe("Community Post Ordering Logic", () => {
    interface TestPost {
      id: string;
      pinned_at: string | null;
      created_at: string;
    }

    function sortCommunityPosts(posts: TestPost[]): TestPost[] {
      return [...posts].sort((a, b) => {
        // Pinned posts first (pinned_at DESC NULLS LAST)
        if (a.pinned_at && !b.pinned_at) return -1;
        if (!a.pinned_at && b.pinned_at) return 1;
        if (a.pinned_at && b.pinned_at) {
          const pinnedDiff = new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
          if (pinnedDiff !== 0) return pinnedDiff;
        }
        // Reverse-chronological by created_at DESC
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }

    it("places pinned posts at the top of the feed regardless of creation date", () => {
      const posts: TestPost[] = [
        { id: "post-1", pinned_at: null, created_at: "2026-10-09T10:00:00Z" },
        { id: "post-2", pinned_at: "2026-10-09T12:00:00Z", created_at: "2026-10-08T08:00:00Z" },
        { id: "post-3", pinned_at: null, created_at: "2026-10-09T11:00:00Z" },
      ];

      const sorted = sortCommunityPosts(posts);
      expect(sorted[0].id).toBe("post-2"); // pinned post first
      expect(sorted[1].id).toBe("post-3"); // newer regular post second
      expect(sorted[2].id).toBe("post-1"); // older regular post third
    });

    it("orders multiple pinned posts by most recently pinned", () => {
      const posts: TestPost[] = [
        { id: "p1", pinned_at: "2026-10-09T09:00:00Z", created_at: "2026-10-09T08:00:00Z" },
        { id: "p2", pinned_at: "2026-10-09T11:00:00Z", created_at: "2026-10-09T07:00:00Z" },
        { id: "p3", pinned_at: null, created_at: "2026-10-09T10:00:00Z" },
      ];

      const sorted = sortCommunityPosts(posts);
      expect(sorted[0].id).toBe("p2"); // pinned at 11:00
      expect(sorted[1].id).toBe("p1"); // pinned at 09:00
      expect(sorted[2].id).toBe("p3"); // unpinned
    });

    it("orders unpinned posts in strict reverse-chronological order", () => {
      const posts: TestPost[] = [
        { id: "p1", pinned_at: null, created_at: "2026-10-09T08:00:00Z" },
        { id: "p2", pinned_at: null, created_at: "2026-10-09T12:00:00Z" },
        { id: "p3", pinned_at: null, created_at: "2026-10-09T10:00:00Z" },
      ];

      const sorted = sortCommunityPosts(posts);
      expect(sorted.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
    });
  });

  describe("Removal Reason Validation", () => {
    function isValidRemovalReason(reason: unknown): boolean {
      return (
        reason === null ||
        reason === undefined ||
        (typeof reason === "string" && reason.length <= 500)
      );
    }

    it("accepts null or undefined removal reason", () => {
      expect(isValidRemovalReason(null)).toBe(true);
      expect(isValidRemovalReason(undefined)).toBe(true);
    });

    it("accepts valid removal reason under 500 characters", () => {
      const reason = "Post violated community guidelines on promotional content.";
      expect(isValidRemovalReason(reason)).toBe(true);
    });

    it("rejects removal reason exceeding 500 characters", () => {
      const reason = "a".repeat(501);
      expect(isValidRemovalReason(reason)).toBe(false);
    });
  });
});
