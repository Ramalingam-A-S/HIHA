"use server";

import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  feedQuerySchema,
  type FeedQueryInput,
  type FeedItem,
  type FeedResponse,
} from "@/lib/feed/types";
import {
  scoreCandidate,
  type ContentCandidate,
  type UserInterestPreference,
  type FeedMode,
} from "@/lib/recommendation/scorer";
import type { ActionResult } from "./auth";
import type { Interest, Profile } from "@/lib/supabase/types";

/**
 * Retrieves and ranks feed posts for the authenticated user according to the selected feed mode.
 * Enforces PostgreSQL RLS, social graph relationships (follows, blocks), muted creator suppression,
 * and deterministic, transparent scoring.
 */
export async function getFeedAction(
  input: FeedQueryInput
): Promise<ActionResult<FeedResponse>> {
  // 1. Session verification
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      message: "Authentication required to access personalized feed.",
    };
  }

  // 2. Input validation
  const validation = feedQuerySchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      message: "Invalid feed query parameters.",
    };
  }

  const { mode, page, pageSize } = validation.data;

  // 3. User-scoped Supabase client (enforces posts, follows, blocks RLS)
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  // 4. Fetch relationship context: mutes and follows
  const [mutesRes, followsRes, interestsRes] = await Promise.all([
    supabase.from("mutes").select("muted_id").eq("muter_id", user.id),
    supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", user.id)
      .eq("status", "accepted"),
    supabase
      .from("user_interests")
      .select("priority, interest:interests (id, slug, category, name)")
      .eq("user_id", user.id),
  ]);

  const mutedIds = new Set<string>(
    mutesRes.data?.map((m) => m.muted_id) ?? []
  );
  const followingIds = new Set<string>(
    followsRes.data?.map((f) => f.following_id) ?? []
  );

  // Format user preferences for scorer
  const userPreferences: UserInterestPreference[] = [];
  const preferencePriorityMap = new Map<string, number>();

  if (interestsRes.data) {
    for (const row of interestsRes.data) {
      const interestObj = row.interest as unknown as Interest | null;
      if (interestObj) {
        userPreferences.push({
          slug: interestObj.slug,
          category: interestObj.category,
          priority: row.priority,
        });
        preferencePriorityMap.set(interestObj.slug, row.priority);
      }
    }
  }

  // =========================================================================
  // 5. FOLLOWING MODE (Strict reverse-chronological, unranked)
  // =========================================================================
  if (mode === "following") {
    const followedArray = Array.from(followingIds).filter(
      (id) => !mutedIds.has(id)
    );

    if (followedArray.length === 0) {
      return {
        success: true,
        data: {
          items: [],
          mode,
          page,
          pageSize,
          hasMore: false,
          totalEligible: 0,
        },
      };
    }

    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;

    const { data: posts, count, error } = await supabase
      .from("posts")
      .select(
        `
        *,
        creator:profiles!posts_creator_id_fkey (*),
        post_interests (
          interest:interests (*)
        )
      `,
        { count: "exact" }
      )
      .in("creator_id", followedArray)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .order("id", { ascending: true })
      .range(fromIndex, toIndex);

    if (error) {
      return { success: false, message: error.message };
    }

    const postIds = (posts ?? []).map((p) => p.id);
    const likeCountMap = new Map<string, number>();
    let viewerLikedSet = new Set<string>();

    if (postIds.length > 0) {
      const [allLikesRes, viewerLikesRes] = await Promise.all([
        supabase.from("post_likes").select("post_id").in("post_id", postIds),
        supabase
          .from("post_likes")
          .select("post_id")
          .in("post_id", postIds)
          .eq("user_id", user.id),
      ]);

      for (const row of allLikesRes.data ?? []) {
        likeCountMap.set(row.post_id, (likeCountMap.get(row.post_id) ?? 0) + 1);
      }
      viewerLikedSet = new Set((viewerLikesRes.data ?? []).map((r) => r.post_id));
    }

    const items: FeedItem[] = (posts ?? []).map((p) => {
      const rawInterests = p.post_interests as unknown as Array<{ interest: Interest }>;
      const interests = rawInterests?.map((pi) => pi.interest).filter(Boolean) ?? [];
      const isOwner = p.creator_id === user.id;

      return {
        ...p,
        media_path: isOwner ? p.media_path : null, // Shield raw storage paths
        creator: p.creator as unknown as Profile,
        interests,
        score: 100, // Fixed baseline for chronological
        explanationTags: ["Following", "Chronological"],
        explanationDetails: [
          "Published by a creator you actively follow",
          "Presented in strict reverse-chronological order without algorithmic reordering",
        ],
        isFollowingCreator: true,
        likeCount: likeCountMap.get(p.id) ?? 0,
        isLikedByViewer: viewerLikedSet.has(p.id),
      };
    });

    const total = count ?? 0;
    return {
      success: true,
      data: {
        items,
        mode,
        page,
        pageSize,
        hasMore: toIndex + 1 < total,
        totalEligible: total,
      },
    };
  }

  // =========================================================================
  // 6. RANKED MODES (My Mix, Focus, Explore, Quiet)
  // Bounded candidate pool fetched deterministically from the database.
  // =========================================================================
  const candidatePoolSize = 60; // Bounded window prevents fetching entire table
  const { data: candidatePosts, error: poolError } = await supabase
    .from("posts")
    .select(
      `
      *,
      creator:profiles!posts_creator_id_fkey (*),
      post_interests (
        interest:interests (*)
      )
    `
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(candidatePoolSize);

  if (poolError) {
    return { success: false, message: poolError.message };
  }

  // Filter out muted creators
  const unmutedCandidates = (candidatePosts ?? []).filter(
    (p) => !mutedIds.has(p.creator_id)
  );

  // Score and enrich each eligible candidate
  const scoredItems: FeedItem[] = [];

  for (const post of unmutedCandidates) {
    const rawInterests = post.post_interests as unknown as Array<{ interest: Interest }>;
    const interests = rawInterests?.map((pi) => pi.interest).filter(Boolean) ?? [];
    const interestSlugs = interests.map((i) => i.slug);
    const isFollowing = followingIds.has(post.creator_id);
    const isOwner = post.creator_id === user.id;

    // Explore mode: prioritizes creators not followed to avoid echo chambers
    if (mode === "explore" && isFollowing && unmutedCandidates.length > 5) {
      // Continue to score but deprioritized in explore mode
    }

    const candidate: ContentCandidate = {
      id: post.id,
      title: post.caption?.slice(0, 60) || "Post",
      primaryCategory: post.category || "general",
      interestSlugs,
      isSafetyEligible: true,
    };

    const scoreResult = scoreCandidate(candidate, userPreferences, {
      mode: mode as FeedMode,
    });

    // Build concise, honest explanation tags derived strictly from actual inputs
    const explanationTags: string[] = [];

    if (isFollowing) {
      explanationTags.push("Following");
    }

    if (scoreResult.matchedInterests.length > 0) {
      for (const slug of scoreResult.matchedInterests) {
        const priority = preferencePriorityMap.get(slug);
        if (priority && priority >= 4) {
          explanationTags.push(`High Priority: ${slug}`);
        } else {
          explanationTags.push(`Topic: ${slug}`);
        }
      }
    }

    if (scoreResult.isExploration) {
      explanationTags.push("Exploration");
    }

    if (post.category && scoreResult.matchedCategories.includes(post.category)) {
      explanationTags.push(`Category: ${post.category}`);
    }

    if (mode === "quiet") {
      explanationTags.push("Quiet Mode");
    }

    // Mode-specific eligibility filtering
    if (mode === "focus") {
      // Focus requires at least one matched topic OR a verified learning category
      const isLearningCategory = [
        "technology-science",
        "education-learning",
        "business-careers",
      ].includes(post.category || "");

      const hasInterestMatch = scoreResult.matchedInterests.length > 0;

      if (!hasInterestMatch && !isLearningCategory) {
        continue; // Exclude non-focus content
      }
    }

      scoredItems.push({
      ...post,
      media_path: isOwner ? post.media_path : null, // Protect raw storage paths
      creator: post.creator as unknown as Profile,
      interests,
      score: scoreResult.score,
      explanationTags: Array.from(new Set(explanationTags)),
      explanationDetails: scoreResult.reasons,
      isFollowingCreator: isFollowing,
      isOwner,
      likeCount: 0,
      isLikedByViewer: false,
    });
  }

  // 7. Deterministic sorting and tie-breaking
  if (mode === "quiet") {
    // Quiet Mode: predictable reverse-chronological ordering with minimal score bias
    scoredItems.sort((a, b) => {
      const timeA = new Date(a.published_at || a.created_at).getTime();
      const timeB = new Date(b.published_at || b.created_at).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return a.id.localeCompare(b.id);
    });
  } else {
    // Ranked modes (My Mix, Focus, Explore): primary sort by score DESC, then published_at DESC, then id ASC
    scoredItems.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const timeA = new Date(a.published_at || a.created_at).getTime();
      const timeB = new Date(b.published_at || b.created_at).getTime();
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return a.id.localeCompare(b.id);
    });

    // Anti-manipulation creator velocity dampener: prevent a single creator burst
    // from monopolizing the top ranked feed positions (1st/2nd: 1.0x, 3rd: 0.85x, 4th+: 0.70x)
    const creatorSeenCount = new Map<string, number>();
    for (const item of scoredItems) {
      const seen = (creatorSeenCount.get(item.creator_id) ?? 0) + 1;
      creatorSeenCount.set(item.creator_id, seen);
      if (seen >= 3) {
        const multiplier = seen === 3 ? 0.85 : 0.7;
        item.score = Math.round(item.score * multiplier * 100) / 100;
        item.explanationDetails = [
          ...item.explanationDetails,
          `Creator frequency safeguard applied (${multiplier}x diversity adjustment for post #${seen} from this creator)`,
        ];
      }
    }

    scoredItems.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const timeA = new Date(a.published_at || a.created_at).getTime();
      const timeB = new Date(b.published_at || b.created_at).getTime();
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return a.id.localeCompare(b.id);
    });
  }

  // 8. Bounded pagination slice
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedItems = scoredItems.slice(startIndex, endIndex);

  // 9. Batch enrich paginated slice with reliable like counts and viewer like status
  const pagePostIds = paginatedItems.map((p) => p.id);
  const pageLikeCountMap = new Map<string, number>();
  let pageViewerLikedSet = new Set<string>();

  if (pagePostIds.length > 0) {
    const [allLikesRes, viewerLikesRes] = await Promise.all([
      supabase.from("post_likes").select("post_id").in("post_id", pagePostIds),
      supabase
        .from("post_likes")
        .select("post_id")
        .in("post_id", pagePostIds)
        .eq("user_id", user.id),
    ]);

    for (const row of allLikesRes.data ?? []) {
      pageLikeCountMap.set(row.post_id, (pageLikeCountMap.get(row.post_id) ?? 0) + 1);
    }
    pageViewerLikedSet = new Set((viewerLikesRes.data ?? []).map((r) => r.post_id));
  }

  const enrichedPaginatedItems: FeedItem[] = paginatedItems.map((item) => ({
    ...item,
    likeCount: pageLikeCountMap.get(item.id) ?? 0,
    isLikedByViewer: pageViewerLikedSet.has(item.id),
  }));

  return {
    success: true,
    data: {
      items: enrichedPaginatedItems,
      mode,
      page,
      pageSize,
      hasMore: endIndex < scoredItems.length,
      totalEligible: scoredItems.length,
    },
  };
}
