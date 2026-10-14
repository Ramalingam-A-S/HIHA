export type SupportedMediaType = "image" | "short_video" | "long_video";

export interface MediaConstraints {
  maxSizeBytes: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maxDurationSeconds?: number;
}

export const MEDIA_CONSTRAINTS: Record<SupportedMediaType, MediaConstraints> = {
  image: {
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
  },
  short_video: {
    maxSizeBytes: 100 * 1024 * 1024, // 100 MB
    allowedMimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    allowedExtensions: ["mp4", "webm", "mov"],
    maxDurationSeconds: 60, // 60s max for short video
  },
  long_video: {
    maxSizeBytes: 500 * 1024 * 1024, // 500 MB
    allowedMimeTypes: ["video/mp4", "video/webm"],
    allowedExtensions: ["mp4", "webm"],
  },
};

export interface UploadIntentResult {
  path: string;
  signedUploadUrl: string;
  token?: string;
  bucket: string;
}

export interface MediaMetadata {
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface MediaStorageProvider {
  /**
   * Generates a signed upload authorization URL allowing the authenticated client
   * to upload directly to their dedicated user storage path without passing raw media
   * through the Next.js server runtime.
   *
   * Validates filename structure and explicitly supported extension for mediaType.
   */
  createUploadIntent(
    userId: string,
    filename: string,
    mediaType: SupportedMediaType
  ): Promise<{ success: boolean; data?: UploadIntentResult; error?: string }>;

  /**
   * Generates a time-limited signed download URL for private media objects.
   * Default expiration: 300 seconds (5 minutes).
   */
  getSignedUrl(path: string, expiresInSeconds?: number): Promise<string | null>;

  /**
   * Deletes a storage object, strictly asserting caller ownership of the path.
   */
  deleteFile(userId: string, path: string): Promise<boolean>;

  /**
   * Enforces that a storage path matches the authenticated creator's scope:
   * Pattern: "{userId}/{fileId}.{ext}"
   */
  validatePathOwnership(userId: string, path: string): boolean;

  /**
   * Validates file size, MIME type, and extension according to HIHA platform boundaries.
   */
  validateFileConstraints(
    mediaType: SupportedMediaType,
    mimeType: string,
    sizeBytes: number,
    extension?: string
  ): { valid: boolean; error?: string };

  /**
   * Validates whether a storage path is a canonical collaborative stitched render output path:
   * Pattern: "{creatorId}/stitched-{projectId}-{jobId}-{hex8}.mp4"
   */
  validateCanonicalRenderOutputPath(path: string): boolean;

  /**
   * Deletes a batch of validated storage paths from the media bucket.
   * Uses the server-only admin client when available, falling back to the authenticated server client.
   */
  deleteFilesBatch(
    paths: string[]
  ): Promise<{ success: boolean; deletedCount: number; error?: string }>;

  /**
   * Lists and deletes all objects remaining inside a user's '{userId}/' storage directory.
   */
  deleteUserFolderContents(
    userId: string
  ): Promise<{ success: boolean; deletedCount: number; error?: string }>;
}
