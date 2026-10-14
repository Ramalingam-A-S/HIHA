import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name cannot be empty")
    .max(60, "Display name must be at most 60 characters"),
  bio: z
    .string()
    .trim()
    .max(500, "Bio must be at most 500 characters")
    .nullable()
    .optional()
    .transform((val) => (val === "" ? null : val)),
  isPrivate: z.boolean(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
