import { z } from "zod";
import type { Community, CommunityMember, Profile, Interest } from "@/lib/supabase/types";

export const COMMUNITY_VISIBILITIES = ["public", "private"] as const;
export type CommunityVisibility = (typeof COMMUNITY_VISIBILITIES)[number];

export const COMMUNITY_ROLES = ["owner", "moderator", "member"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

export const COMMUNITY_STATUSES = ["active", "pending", "rejected", "banned"] as const;
export type CommunityStatus = (typeof COMMUNITY_STATUSES)[number];

export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const createCommunitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name cannot exceed 100 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Slug must be at least 2 characters.")
    .max(50, "Slug cannot exceed 50 characters.")
    .regex(SLUG_REGEX, "Slug may only contain lowercase letters, numbers, and hyphens."),
  description: z
    .string()
    .trim()
    .max(1000, "Description cannot exceed 1000 characters.")
    .optional()
    .nullable(),
  visibility: z.enum(COMMUNITY_VISIBILITIES).default("public"),
  interestId: z.string().uuid("Invalid interest identifier.").optional().nullable(),
  category: z.string().trim().max(50).optional().nullable(),
});

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;

export const communityQuerySchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(50).optional().default(20),
  category: z.string().optional().nullable(),
  search: z.string().max(100).optional().nullable(),
});

export type CommunityQueryInput = z.input<typeof communityQuerySchema>;

export interface ViewerMembership {
  role: CommunityRole;
  status: CommunityStatus;
}

export interface CommunityWithDetails extends Community {
  owner: Profile;
  interest?: Interest | null;
  memberCount: number;
  viewerMembership: ViewerMembership | null;
}

export interface CommunityMemberWithProfile extends CommunityMember {
  user: Profile;
}
