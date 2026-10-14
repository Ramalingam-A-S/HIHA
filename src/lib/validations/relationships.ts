import { z } from "zod";

export const targetUserSchema = z.object({
  targetUserId: z.string().uuid("Invalid target user ID"),
});

export const followResponseSchema = z.object({
  followId: z.string().uuid("Invalid follow relationship ID"),
  action: z.enum(["accept", "reject"], {
    message: "Action must be 'accept' or 'reject'",
  }),
});

export type TargetUserInput = z.infer<typeof targetUserSchema>;
export type FollowResponseInput = z.infer<typeof followResponseSchema>;
