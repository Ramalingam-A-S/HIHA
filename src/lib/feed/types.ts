import { z } from "zod";
import type { PostWithDetails } from "@/lib/supabase/types";
import type { FeedMode } from "@/lib/recommendation/scorer";

export const FEED_MODES = ["my-mix", "focus", "following", "explore", "quiet"] as const;

export const feedQuerySchema = z.object({
  mode: z.enum(FEED_MODES).default("my-mix"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(15),
});

export type FeedQueryInput = z.infer<typeof feedQuerySchema>;

export interface FeedItem extends PostWithDetails {
  score: number;
  explanationTags: string[];
  explanationDetails: string[];
  isFollowingCreator: boolean;
  isOwner?: boolean;
  likeCount: number;
  isLikedByViewer: boolean;
}

export interface FeedResponse {
  items: FeedItem[];
  mode: FeedMode;
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalEligible: number;
}
