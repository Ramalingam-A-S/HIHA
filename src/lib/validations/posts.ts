import { z } from "zod";
import { categoryIds } from "./interests";
import {
  aiDisclosureDetailsSchema,
  aiDisclosureStatusSchema,
} from "@/lib/authenticity/types";

export const POST_CONTENT_TYPES = [
  "text",
  "image",
  "short_video",
  "long_video",
] as const;

export const POST_STATUSES = ["draft", "published"] as const;

export const POST_VISIBILITIES = ["public", "followers", "private"] as const;

export const createPostSchema = z
  .object({
    content_type: z.enum(POST_CONTENT_TYPES, {
      message: "Invalid content type",
    }),
    caption: z
      .string()
      .max(2200, "Caption cannot exceed 2,200 characters")
      .optional()
      .nullable(),
    media_path: z
      .string()
      .regex(
        /^[0-9a-fA-F-]{36}\/[a-zA-Z0-9._-]+$/,
        "Invalid media path format. Must follow '{userId}/{fileId}.{ext}'"
      )
      .optional()
      .nullable(),
    media_metadata: z
      .object({
        mimeType: z.string(),
        sizeBytes: z.number().positive(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        durationSeconds: z.number().positive().optional(),
      })
      .optional()
      .nullable(),
    status: z.enum(POST_STATUSES).default("draft"),
    visibility: z.enum(POST_VISIBILITIES).default("public"),
    category: z.enum(categoryIds).optional().nullable(),
    interestIds: z.array(z.string().uuid("Invalid interest ID")).max(5).optional(),
    ai_disclosure_status: aiDisclosureStatusSchema.default("not_declared"),
    ai_disclosure_details: aiDisclosureDetailsSchema,
  })
  .refine(
    (data) => {
      if (data.content_type === "text") {
        return Boolean(data.caption && data.caption.trim().length >= 1);
      }
      return true;
    },
    {
      message: "Text posts must contain non-empty text",
      path: ["caption"],
    }
  )
  .refine(
    (data) => {
      if (data.content_type !== "text" && data.status === "published") {
        return Boolean(data.media_path);
      }
      return true;
    },
    {
      message: "Published media posts must have a validated media object attached",
      path: ["media_path"],
    }
  )
  .refine(
    (data) => {
      if (
        data.ai_disclosure_status === "not_declared" &&
        data.ai_disclosure_details
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "Disclosure details require selecting a disclosure status other than not_declared",
      path: ["ai_disclosure_details"],
    }
  );

export const updatePostSchema = z
  .object({
    postId: z.string().uuid("Invalid post ID"),
    caption: z
      .string()
      .max(2200, "Caption cannot exceed 2,200 characters")
      .optional()
      .nullable(),
    visibility: z.enum(POST_VISIBILITIES).optional(),
    category: z.enum(categoryIds).optional().nullable(),
    interestIds: z.array(z.string().uuid("Invalid interest ID")).max(5).optional(),
    ai_disclosure_status: aiDisclosureStatusSchema.optional(),
    ai_disclosure_details: aiDisclosureDetailsSchema,
  })
  .refine(
    (data) => {
      if (
        data.ai_disclosure_status === "not_declared" &&
        data.ai_disclosure_details
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "Disclosure details require selecting a disclosure status other than not_declared",
      path: ["ai_disclosure_details"],
    }
  );

export const publishPostSchema = z.object({
  postId: z.string().uuid("Invalid post ID"),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type PublishPostInput = z.infer<typeof publishPostSchema>;
