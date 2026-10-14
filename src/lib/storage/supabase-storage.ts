import {
  type MediaStorageProvider,
  type SupportedMediaType,
  type UploadIntentResult,
  MEDIA_CONSTRAINTS,
} from "./types";

export const MEDIA_BUCKET = "media";
export const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes

export class SupabaseMediaStorageProvider implements MediaStorageProvider {
  /**
   * Enforces that a storage path matches the authenticated creator's folder scope:
   * Pattern: "{userId}/{fileId}.{ext}"
   */
  validatePathOwnership(userId: string, path: string): boolean {
    if (!path || !userId) return false;
    const pathRegex = /^[0-9a-fA-F-]{36}\/[a-zA-Z0-9._-]+$/;
    if (!pathRegex.test(path)) return false;
    return path.startsWith(`${userId}/`);
  }

  /**
   * Validates file size, MIME type, and extension according to HIHA platform boundaries.
   *
   * NOTE ON VERIFICATION BOUNDARIES:
   * - Checked at upload intent time: File extension match against allowed list, media type validity.
   * - Checked by Supabase Storage at upload time: HTTP Content-Type and byte length within bucket limits.
   * - Requires post-upload verification in media processing pipeline (future milestone):
   *   Actual binary magic bytes/signatures, true media dimensions, and video duration cannot be
   *   guaranteed solely from client-reported headers before ingestion.
   */
  validateFileConstraints(
    mediaType: SupportedMediaType,
    mimeType: string,
    sizeBytes: number,
    extension?: string
  ): { valid: boolean; error?: string } {
    const constraints = MEDIA_CONSTRAINTS[mediaType];
    if (!constraints) {
      return { valid: false, error: `Unsupported media type: ${mediaType}` };
    }

    if (extension) {
      const cleanExt = extension.toLowerCase().replace(/^\./, "");
      if (!constraints.allowedExtensions.includes(cleanExt)) {
        return {
          valid: false,
          error: `Invalid file extension .${cleanExt} for ${mediaType}. Allowed: ${constraints.allowedExtensions.join(", ")}`,
        };
      }
    }

    if (!constraints.allowedMimeTypes.includes(mimeType)) {
      return {
        valid: false,
        error: `Invalid format: ${mimeType}. Allowed: ${constraints.allowedMimeTypes.join(", ")}`,
      };
    }

    if (sizeBytes > constraints.maxSizeBytes) {
      const maxMb = Math.round(constraints.maxSizeBytes / (1024 * 1024));
      return {
        valid: false,
        error: `File size exceeds the limit of ${maxMb}MB for ${mediaType}`,
      };
    }

    return { valid: true };
  }

  /**
   * Generates a signed direct upload URL for the private 'media' bucket.
   *
   * Validates filename structure and explicitly supported extension for mediaType:
   * - Rejects path traversal characters ('..', '/', '\').
   * - Rejects filenames with no extension or hidden file names.
   * - Enforces whitelist of allowed extensions per media type.
   * - Generates server-isolated UUID storage path: '{userId}/{randomUUID}.{ext}'.
   */
  async createUploadIntent(
    userId: string,
    filename: string,
    mediaType: SupportedMediaType
  ): Promise<{ success: boolean; data?: UploadIntentResult; error?: string }> {
    // 1. Validate userId format
    const uuidRegex = /^[0-9a-fA-F-]{36}$/;
    if (!userId || !uuidRegex.test(userId)) {
      return { success: false, error: "Invalid user identifier" };
    }

    // 2. Validate mediaType
    const constraints = MEDIA_CONSTRAINTS[mediaType];
    if (!constraints) {
      return { success: false, error: `Unsupported media type: ${mediaType}` };
    }

    // 3. Reject path traversal and illegal path components
    if (
      !filename ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("..") ||
      filename.startsWith(".")
    ) {
      return {
        success: false,
        error: "Invalid filename: path traversal, path separators, and hidden files are rejected",
      };
    }

    // 4. Extract and validate extension
    const parts = filename.split(".");
    if (parts.length < 2) {
      return {
        success: false,
        error: "Filename must contain a valid file extension",
      };
    }

    const rawExt = parts.pop()?.toLowerCase() || "";
    const cleanExt = rawExt.replace(/[^a-z0-9]/g, "");

    if (!constraints.allowedExtensions.includes(cleanExt)) {
      return {
        success: false,
        error: `Invalid file extension '.${cleanExt}' for ${mediaType}. Allowed: ${constraints.allowedExtensions.join(", ")}`,
      };
    }

    // 5. Generate server-isolated object key (never use client-supplied names)
    const fileId = crypto.randomUUID();
    const storagePath = `${userId}/${fileId}.${cleanExt}`;

    if (!this.validatePathOwnership(userId, storagePath)) {
      return { success: false, error: "Invalid storage path scope" };
    }

    // Lazy import to avoid loading Next.js server-only module at module init time
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      return {
        success: false,
        error: error?.message || "Failed to generate signed upload authorization",
      };
    }

    return {
      success: true,
      data: {
        path: storagePath,
        signedUploadUrl: data.signedUrl,
        token: data.token,
        bucket: MEDIA_BUCKET,
      },
    };
  }

  /**
   * Generates a time-limited signed download URL for private media objects.
   * Default expiration: 300 seconds (5 minutes).
   */
  async getSignedUrl(
    path: string,
    expiresInSeconds: number = DEFAULT_SIGNED_URL_EXPIRY_SECONDS
  ): Promise<string | null> {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data) {
      return null;
    }

    return data.signedUrl;
  }

  /**
   * Deletes a storage object, strictly asserting caller ownership of the path.
   */
  async deleteFile(userId: string, path: string): Promise<boolean> {
    if (!this.validatePathOwnership(userId, path)) {
      return false;
    }

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    return !error;
  }

  /**
   * Validates whether a storage path is a canonical collaborative stitched render output path:
   * Pattern: "{creatorId}/stitched-{projectId}-{jobId}-{hex8}.mp4"
   */
  validateCanonicalRenderOutputPath(path: string): boolean {
    if (!path) return false;
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/stitched-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[0-9a-fA-F]{8}\.mp4$/.test(
      path
    );
  }

  /**
   * Deletes a batch of validated storage paths from the media bucket.
   * Uses the server-only admin client when available, falling back to the authenticated server client.
   */
  async deleteFilesBatch(
    paths: string[]
  ): Promise<{ success: boolean; deletedCount: number; error?: string }> {
    const validPathRegex = /^[0-9a-fA-F-]{36}\/[a-zA-Z0-9._-]+$/;
    const uniquePaths = Array.from(
      new Set(
        paths
          .map((p) => (typeof p === "string" ? p.trim() : ""))
          .filter((p) => p.length > 0 && validPathRegex.test(p))
      )
    );

    if (uniquePaths.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const { tryCreateAdminClient } = await import("@/lib/supabase/admin");
    const { createClient } = await import("@/lib/supabase/server");
    const storageClient = tryCreateAdminClient() ?? (await createClient());

    let deletedCount = 0;
    const chunkSize = 100;
    for (let i = 0; i < uniquePaths.length; i += chunkSize) {
      const chunk = uniquePaths.slice(i, i + chunkSize);
      const { error } = await storageClient.storage
        .from(MEDIA_BUCKET)
        .remove(chunk);

      if (error) {
        return {
          success: false,
          deletedCount,
          error: error.message || "Failed to delete media batch from storage",
        };
      }
      deletedCount += chunk.length;
    }

    return { success: true, deletedCount };
  }

  /**
   * Lists and deletes all objects remaining inside a user's '{userId}/' storage directory.
   */
  async deleteUserFolderContents(
    userId: string
  ): Promise<{ success: boolean; deletedCount: number; error?: string }> {
    const uuidRegex = /^[0-9a-fA-F-]{36}$/;
    if (!userId || !uuidRegex.test(userId)) {
      return {
        success: false,
        deletedCount: 0,
        error: "Invalid user identifier for storage folder cleanup",
      };
    }

    const { tryCreateAdminClient } = await import("@/lib/supabase/admin");
    const { createClient } = await import("@/lib/supabase/server");
    const storageClient = tryCreateAdminClient() ?? (await createClient());

    const { data: listed, error: listErr } = await storageClient.storage
      .from(MEDIA_BUCKET)
      .list(userId, { limit: 1000 });

    if (listErr) {
      return {
        success: false,
        deletedCount: 0,
        error: listErr.message || "Failed to list user media directory",
      };
    }

    if (!listed || listed.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const folderPaths = listed
      .filter((item) => item.name && item.name !== ".emptyFolderPlaceholder")
      .map((item) => `${userId}/${item.name}`);

    if (folderPaths.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    return this.deleteFilesBatch(folderPaths);
  }
}

// Default singleton instance
export const defaultStorageProvider = new SupabaseMediaStorageProvider();
