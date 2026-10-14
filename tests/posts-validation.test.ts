import { describe, it, expect } from "vitest";
import {
  createPostSchema,
  updatePostSchema,
} from "@/lib/validations/posts";
import { SupabaseMediaStorageProvider } from "@/lib/storage/supabase-storage";

describe("Milestone 2.3: Posts Validation & Media Constraints", () => {
  const storageProvider = new SupabaseMediaStorageProvider();
  const testUserId = "123e4567-e89b-12d3-a456-426614174000";

  describe("Post Creation Validation (createPostSchema)", () => {
    it("accepts valid published text post with caption", () => {
      const res = createPostSchema.safeParse({
        content_type: "text",
        caption: "A responsible thought on human-centric algorithms.",
        status: "published",
        visibility: "public",
        category: "technology-science",
      });
      expect(res.success).toBe(true);
    });

    it("rejects text post with empty or whitespace-only caption", () => {
      const emptyRes = createPostSchema.safeParse({
        content_type: "text",
        caption: "",
        status: "published",
      });
      const whitespaceRes = createPostSchema.safeParse({
        content_type: "text",
        caption: "    ",
        status: "published",
      });
      expect(emptyRes.success).toBe(false);
      expect(whitespaceRes.success).toBe(false);
    });

    it("rejects caption exceeding 2,200 characters", () => {
      const longCaption = "A".repeat(2201);
      const res = createPostSchema.safeParse({
        content_type: "text",
        caption: longCaption,
        status: "published",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("2,200 characters");
      }
    });

    it("accepts media post draft without media_path", () => {
      const res = createPostSchema.safeParse({
        content_type: "image",
        status: "draft",
        visibility: "public",
      });
      expect(res.success).toBe(true);
    });

    it("rejects published media post without media_path", () => {
      const res = createPostSchema.safeParse({
        content_type: "image",
        status: "published",
        visibility: "public",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("validated media object attached");
      }
    });

    it("accepts published media post with valid media_path format", () => {
      const res = createPostSchema.safeParse({
        content_type: "image",
        status: "published",
        media_path: `${testUserId}/test-image-123.jpg`,
        visibility: "public",
      });
      expect(res.success).toBe(true);
    });

    it("rejects invalid media_path format", () => {
      const res = createPostSchema.safeParse({
        content_type: "image",
        status: "published",
        media_path: "arbitrary-unscoped-path.png",
      });
      expect(res.success).toBe(false);
    });

    it("rejects invalid content_type", () => {
      const res = createPostSchema.safeParse({
        content_type: "podcast_audio",
        caption: "Audio post",
        status: "published",
      });
      expect(res.success).toBe(false);
    });

    it("rejects invalid category", () => {
      const res = createPostSchema.safeParse({
        content_type: "text",
        caption: "Valid caption",
        category: "cryptocurrency-speculation",
      });
      expect(res.success).toBe(false);
    });
  });

  describe("Media Storage Abstraction Constraints", () => {
    it("validates path ownership scoped strictly to creator UUID", () => {
      const validPath = `${testUserId}/photo-001.webp`;
      const crossUserPath = `other-user-uuid/photo-001.webp`;
      const rootPath = `photo-001.webp`;

      expect(storageProvider.validatePathOwnership(testUserId, validPath)).toBe(true);
      expect(storageProvider.validatePathOwnership(testUserId, crossUserPath)).toBe(false);
      expect(storageProvider.validatePathOwnership(testUserId, rootPath)).toBe(false);
    });

    it("accepts allowed MIME types within file size limits", () => {
      const validImage = storageProvider.validateFileConstraints(
        "image",
        "image/jpeg",
        5 * 1024 * 1024 // 5 MB
      );
      expect(validImage.valid).toBe(true);

      const validShortVideo = storageProvider.validateFileConstraints(
        "short_video",
        "video/mp4",
        50 * 1024 * 1024 // 50 MB
      );
      expect(validShortVideo.valid).toBe(true);
    });

    it("rejects disallowed MIME types", () => {
      const invalidExe = storageProvider.validateFileConstraints(
        "image",
        "application/x-msdownload",
        1024
      );
      expect(invalidExe.valid).toBe(false);
      expect(invalidExe.error).toContain("Invalid format");
    });

    it("rejects files exceeding size limits", () => {
      const oversizedImage = storageProvider.validateFileConstraints(
        "image",
        "image/jpeg",
        15 * 1024 * 1024 // 15 MB > 10 MB limit
      );
      expect(oversizedImage.valid).toBe(false);
      expect(oversizedImage.error).toContain("File size exceeds");
    });

    it("validates file extension against allowed extensions", () => {
      const validJpg = storageProvider.validateFileConstraints(
        "image",
        "image/jpeg",
        1024,
        "jpg"
      );
      expect(validJpg.valid).toBe(true);

      const invalidExt = storageProvider.validateFileConstraints(
        "image",
        "image/jpeg",
        1024,
        "exe"
      );
      expect(invalidExt.valid).toBe(false);
      expect(invalidExt.error).toContain("Invalid file extension");
    });
  });

  describe("Upload Intent Security Sanitization", () => {
    it("rejects filenames with path traversal or directory separators", async () => {
      const traversal = await storageProvider.createUploadIntent(
        testUserId,
        "../photo.jpg",
        "image"
      );
      expect(traversal.success).toBe(false);
      expect(traversal.error).toContain("path traversal");

      const nested = await storageProvider.createUploadIntent(
        testUserId,
        "sub/photo.jpg",
        "image"
      );
      expect(nested.success).toBe(false);

      const backslash = await storageProvider.createUploadIntent(
        testUserId,
        "sub\\photo.jpg",
        "image"
      );
      expect(backslash.success).toBe(false);
    });

    it("rejects filenames without extension or hidden dotfiles", async () => {
      const noExt = await storageProvider.createUploadIntent(
        testUserId,
        "filename_no_extension",
        "image"
      );
      expect(noExt.success).toBe(false);
      expect(noExt.error).toContain("valid file extension");

      const dotfile = await storageProvider.createUploadIntent(
        testUserId,
        ".hidden_file",
        "image"
      );
      expect(dotfile.success).toBe(false);
    });

    it("rejects unsupported extensions and media type mismatches", async () => {
      const exeUpload = await storageProvider.createUploadIntent(
        testUserId,
        "malware.exe",
        "image"
      );
      expect(exeUpload.success).toBe(false);
      expect(exeUpload.error).toContain("Invalid file extension");

      const videoAsImage = await storageProvider.createUploadIntent(
        testUserId,
        "video.mp4",
        "image"
      );
      expect(videoAsImage.success).toBe(false);
      expect(videoAsImage.error).toContain("Invalid file extension");
    });
  });

  describe("Post Update Validation (updatePostSchema)", () => {
    it("accepts valid post updates", () => {
      const res = updatePostSchema.safeParse({
        postId: testUserId,
        caption: "Updated caption text",
        visibility: "followers",
      });
      expect(res.success).toBe(true);
    });

    it("rejects update with invalid postId", () => {
      const res = updatePostSchema.safeParse({
        postId: "not-a-uuid",
        caption: "Updated caption text",
      });
      expect(res.success).toBe(false);
    });
  });
});
