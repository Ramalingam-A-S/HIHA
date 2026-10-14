import { describe, it, expect } from "vitest";
import { postIdSchema } from "@/lib/likes/types";

describe("Milestone 3.2B: Likes & Reliable Engagement Counters Logic", () => {
  describe("Zod Validation: postIdSchema", () => {
    it("accepts valid UUID for postId", () => {
      const valid = { postId: "123e4567-e89b-12d3-a456-426614174000" };
      const res = postIdSchema.safeParse(valid);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.postId).toBe("123e4567-e89b-12d3-a456-426614174000");
      }
    });

    it("rejects invalid non-UUID strings", () => {
      expect(postIdSchema.safeParse({ postId: "not-a-uuid" }).success).toBe(false);
      expect(postIdSchema.safeParse({ postId: "" }).success).toBe(false);
      expect(postIdSchema.safeParse({ postId: "12345" }).success).toBe(false);
    });

    it("rejects non-string types", () => {
      expect(postIdSchema.safeParse({ postId: 12345 }).success).toBe(false);
      expect(postIdSchema.safeParse({ postId: null }).success).toBe(false);
      expect(postIdSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("Engagement Counter & Invariant Rules", () => {
    interface PostState {
      id: string;
      creatorId: string;
      status: "draft" | "published";
      visibility: "public" | "followers" | "private";
    }

    interface RelationshipContext {
      isFollower: boolean;
      isBlocked: boolean;
    }

    // Pure logic simulation of PostgreSQL RLS post viewability for like operations
    function canUserLikePost(
      viewerId: string,
      post: PostState,
      context: RelationshipContext
    ): { canLike: boolean; reason?: string } {
      if (context.isBlocked) {
        return { canLike: false, reason: "Blocked relationship" };
      }

      // Creator can view and like their own published or draft posts
      if (viewerId === post.creatorId) {
        return { canLike: true };
      }

      // Non-creators cannot interact with drafts
      if (post.status !== "published") {
        return { canLike: false, reason: "Draft post is ineligible" };
      }

      // Private posts only viewable/likeable by creator
      if (post.visibility === "private") {
        return { canLike: false, reason: "Private post is ineligible" };
      }

      // Followers-only posts require accepted follow
      if (post.visibility === "followers" && !context.isFollower) {
        return { canLike: false, reason: "Non-follower cannot access post" };
      }

      return { canLike: true };
    }

    it("allows viewer to like published public post when not blocked", () => {
      const post: PostState = {
        id: "post-1",
        creatorId: "creator-1",
        status: "published",
        visibility: "public",
      };
      const res = canUserLikePost("viewer-1", post, { isFollower: false, isBlocked: false });
      expect(res.canLike).toBe(true);
    });

    it("prevents viewer from liking another user's draft post", () => {
      const post: PostState = {
        id: "post-draft",
        creatorId: "creator-1",
        status: "draft",
        visibility: "public",
      };
      const res = canUserLikePost("viewer-1", post, { isFollower: false, isBlocked: false });
      expect(res.canLike).toBe(false);
      expect(res.reason).toBe("Draft post is ineligible");
    });

    it("prevents viewer from liking another user's private post", () => {
      const post: PostState = {
        id: "post-private",
        creatorId: "creator-1",
        status: "published",
        visibility: "private",
      };
      const res = canUserLikePost("viewer-1", post, { isFollower: false, isBlocked: false });
      expect(res.canLike).toBe(false);
      expect(res.reason).toBe("Private post is ineligible");
    });

    it("prevents non-follower from liking followers-only post", () => {
      const post: PostState = {
        id: "post-followers",
        creatorId: "creator-1",
        status: "published",
        visibility: "followers",
      };
      const res = canUserLikePost("viewer-1", post, { isFollower: false, isBlocked: false });
      expect(res.canLike).toBe(false);
      expect(res.reason).toBe("Non-follower cannot access post");
    });

    it("allows accepted follower to like followers-only post", () => {
      const post: PostState = {
        id: "post-followers",
        creatorId: "creator-1",
        status: "published",
        visibility: "followers",
      };
      const res = canUserLikePost("viewer-1", post, { isFollower: true, isBlocked: false });
      expect(res.canLike).toBe(true);
    });

    it("strictly blocks like action if relationship is blocked in either direction", () => {
      const post: PostState = {
        id: "post-public",
        creatorId: "creator-1",
        status: "published",
        visibility: "public",
      };
      const res = canUserLikePost("viewer-1", post, { isFollower: true, isBlocked: true });
      expect(res.canLike).toBe(false);
      expect(res.reason).toBe("Blocked relationship");
    });
  });

  describe("Optimistic UI State & Rollback Transitions", () => {
    interface LikeState {
      isLiked: boolean;
      likeCount: number;
    }

    function applyOptimisticToggle(current: LikeState): LikeState {
      const nextLiked = !current.isLiked;
      const nextCount = nextLiked ? current.likeCount + 1 : Math.max(0, current.likeCount - 1);
      return { isLiked: nextLiked, likeCount: nextCount };
    }

    function rollback(previous: LikeState): LikeState {
      return { ...previous };
    }

    it("correctly computes optimistic like increment", () => {
      const initial: LikeState = { isLiked: false, likeCount: 5 };
      const optimistic = applyOptimisticToggle(initial);
      expect(optimistic.isLiked).toBe(true);
      expect(optimistic.likeCount).toBe(6);
    });

    it("correctly computes optimistic unlike decrement", () => {
      const initial: LikeState = { isLiked: true, likeCount: 5 };
      const optimistic = applyOptimisticToggle(initial);
      expect(optimistic.isLiked).toBe(false);
      expect(optimistic.likeCount).toBe(4);
    });

    it("prevents negative like counts on unlike", () => {
      const initial: LikeState = { isLiked: true, likeCount: 0 };
      const optimistic = applyOptimisticToggle(initial);
      expect(optimistic.likeCount).toBe(0);
    });

    it("reliably rolls back state upon network or server error", () => {
      const original: LikeState = { isLiked: false, likeCount: 3 };
      const optimistic = applyOptimisticToggle(original);
      expect(optimistic.isLiked).toBe(true);
      expect(optimistic.likeCount).toBe(4);

      // Simulate failure rollback
      const reverted = rollback(original);
      expect(reverted.isLiked).toBe(false);
      expect(reverted.likeCount).toBe(3);
    });
  });
});
