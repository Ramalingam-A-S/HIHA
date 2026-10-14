import { describe, it, expect } from "vitest";

describe("Milestone 2.3: Posts Visibility & Audience Rules Model", () => {
  // Pure model function replicating the PostgreSQL RLS policy on public.posts
  function isPostVisible(
    callerId: string | null,
    post: {
      creator_id: string;
      status: "draft" | "published";
      visibility: "public" | "followers" | "private";
    },
    relationships: {
      follows: Array<{
        follower_id: string;
        following_id: string;
        status: "pending" | "accepted";
      }>;
      blocks: Array<{ blocker_id: string; blocked_id: string }>;
      mutes: Array<{ muter_id: string; muted_id: string }>;
    }
  ): boolean {
    // 1. Creator can always view their own posts (including drafts and private)
    if (callerId && callerId === post.creator_id) {
      return true;
    }

    // 2. Drafts and private posts are never visible to non-creators
    if (post.status !== "published" || post.visibility === "private") {
      return false;
    }

    // 3. Block check: bidirectional block denies access
    if (callerId) {
      const isBlocked = relationships.blocks.some(
        (b) =>
          (b.blocker_id === post.creator_id && b.blocked_id === callerId) ||
          (b.blocker_id === callerId && b.blocked_id === post.creator_id)
      );
      if (isBlocked) {
        return false;
      }
    }

    // 4. Public posts are visible to all non-blocked users (and anon)
    if (post.visibility === "public") {
      return true;
    }

    // 5. Followers-only posts require an accepted follow relationship
    if (post.visibility === "followers" && callerId) {
      const isAcceptedFollower = relationships.follows.some(
        (f) =>
          f.follower_id === callerId &&
          f.following_id === post.creator_id &&
          f.status === "accepted"
      );
      return isAcceptedFollower;
    }

    return false;
  }

  const creatorA = "creator-a";
  const userB = "user-b";
  const userC = "user-c";

  it("permits creator to view their own drafts and private posts", () => {
    const draftPost = {
      creator_id: creatorA,
      status: "draft" as const,
      visibility: "public" as const,
    };
    const privatePost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "private" as const,
    };
    const rels = { follows: [], blocks: [], mutes: [] };

    expect(isPostVisible(creatorA, draftPost, rels)).toBe(true);
    expect(isPostVisible(creatorA, privatePost, rels)).toBe(true);
  });

  it("strictly hides drafts and private posts from other users", () => {
    const draftPost = {
      creator_id: creatorA,
      status: "draft" as const,
      visibility: "public" as const,
    };
    const privatePost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "private" as const,
    };
    const rels = { follows: [], blocks: [], mutes: [] };

    expect(isPostVisible(userB, draftPost, rels)).toBe(false);
    expect(isPostVisible(userB, privatePost, rels)).toBe(false);
    expect(isPostVisible(null, draftPost, rels)).toBe(false); // Anonymous
  });

  it("allows non-blocked users to view public published posts", () => {
    const publicPost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "public" as const,
    };
    const rels = { follows: [], blocks: [], mutes: [] };

    expect(isPostVisible(userB, publicPost, rels)).toBe(true);
    expect(isPostVisible(null, publicPost, rels)).toBe(true);
  });

  it("hides followers-only post from users who do not follow or have only pending requests", () => {
    const followerPost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "followers" as const,
    };
    const noFollowRels = { follows: [], blocks: [], mutes: [] };
    const pendingRels = {
      follows: [
        {
          follower_id: userB,
          following_id: creatorA,
          status: "pending" as const,
        },
      ],
      blocks: [],
      mutes: [],
    };

    expect(isPostVisible(userB, followerPost, noFollowRels)).toBe(false);
    expect(isPostVisible(userB, followerPost, pendingRels)).toBe(false);
    expect(isPostVisible(null, followerPost, noFollowRels)).toBe(false);
  });

  it("grants access to followers-only post when follow status is accepted", () => {
    const followerPost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "followers" as const,
    };
    const acceptedRels = {
      follows: [
        {
          follower_id: userB,
          following_id: creatorA,
          status: "accepted" as const,
        },
      ],
      blocks: [],
      mutes: [],
    };

    expect(isPostVisible(userB, followerPost, acceptedRels)).toBe(true);
    // User C who has not followed is still blocked
    expect(isPostVisible(userC, followerPost, acceptedRels)).toBe(false);
  });

  it("ensures blocking strictly denies post access even if user is an accepted follower", () => {
    const publicPost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "public" as const,
    };
    const followerPost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "followers" as const,
    };
    const blockedAndFollowedRels = {
      follows: [
        {
          follower_id: userB,
          following_id: creatorA,
          status: "accepted" as const,
        },
      ],
      blocks: [{ blocker_id: creatorA, blocked_id: userB }],
      mutes: [],
    };

    expect(isPostVisible(userB, publicPost, blockedAndFollowedRels)).toBe(false);
    expect(isPostVisible(userB, followerPost, blockedAndFollowedRels)).toBe(false);
  });

  it("mutes do not deny database access to published posts", () => {
    // Muting is a feed algorithm preference, not an RLS access barrier
    const publicPost = {
      creator_id: creatorA,
      status: "published" as const,
      visibility: "public" as const,
    };
    const mutedRels = {
      follows: [],
      blocks: [],
      mutes: [{ muter_id: userB, muted_id: creatorA }],
    };

    expect(isPostVisible(userB, publicPost, mutedRels)).toBe(true);
  });
});
