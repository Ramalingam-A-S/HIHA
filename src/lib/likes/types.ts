import { z } from "zod";

export const postIdSchema = z.object({
  postId: z.string().uuid("Invalid post ID."),
});

export type PostIdInput = z.infer<typeof postIdSchema>;

export interface LikeActionResult {
  isLiked: boolean;
  likeCount: number;
}
