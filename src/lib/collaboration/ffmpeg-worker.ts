import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { MEDIA_BUCKET } from "@/lib/storage/supabase-storage";
import type { Database, ProjectRenderJob } from "@/lib/supabase/types";
import { validateAndOrderRenderManifest } from "./render-provider";
import { CURRENT_CONSENT_POLICY_VERSION, type RenderManifestItem } from "./types";

export const TEMP_DIR_PREFIX = "hiha-render-";

export interface FfmpegBinaryPaths {
  ffmpegPath: string;
  ffprobePath: string;
}

/**
 * Resolves the FFmpeg and ffprobe executable paths.
 * Prefers explicit server environment overrides (`FFMPEG_PATH`, `FFPROBE_PATH`),
 * then pinned static binaries (`ffmpeg-static`, `ffprobe-static`), and finally
 * system PATH fallbacks.
 */
export function resolveFfmpegBinaries(
  rawEnv: Record<string, string | undefined> = process.env
): FfmpegBinaryPaths {
  const resolvedFfmpeg =
    rawEnv.FFMPEG_PATH?.trim() ||
    (typeof ffmpegStatic === "string" && ffmpegStatic.length > 0
      ? ffmpegStatic
      : "ffmpeg");

  const resolvedFfprobe =
    rawEnv.FFPROBE_PATH?.trim() ||
    (ffprobeStatic && typeof ffprobeStatic.path === "string" && ffprobeStatic.path.length > 0
      ? ffprobeStatic.path
      : "ffprobe");

  return {
    ffmpegPath: resolvedFfmpeg,
    ffprobePath: resolvedFfprobe,
  };
}

export interface RenderWorkerLimits {
  maxClipsPerJob: number;
  maxClipSizeBytes: number;
  maxTotalInputBytes: number;
  minClipDurationSeconds: number;
  maxClipDurationSeconds: number;
  maxTotalDurationSeconds: number;
  minDimensionPx: number;
  maxDimensionPx: number;
  allowedVideoCodecs: readonly string[];
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  processTimeoutMs: number;
}

export const DEFAULT_RENDER_WORKER_LIMITS: RenderWorkerLimits = {
  maxClipsPerJob: 20,
  maxClipSizeBytes: 100 * 1024 * 1024, // 100 MB per clip in worker
  maxTotalInputBytes: 300 * 1024 * 1024, // 300 MB total input per job
  minClipDurationSeconds: 0.2,
  maxClipDurationSeconds: 180,
  maxTotalDurationSeconds: 600,
  minDimensionPx: 64,
  maxDimensionPx: 3840,
  allowedVideoCodecs: ["h264", "hevc", "vp8", "vp9", "av1", "mpeg4"],
  targetWidth: 640,
  targetHeight: 360,
  targetFps: 24,
  processTimeoutMs: 120_000,
};

export interface ProbedMediaInfo {
  filePath: string;
  sizeBytes: number;
  formatName: string;
  durationSeconds: number;
  videoCodec: string;
  width: number;
  height: number;
  pixelFormat: string;
  hasAudio: boolean;
  audioCodec: string | null;
}

export interface ClipValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Executes a binary using `execFile` (`shell: false`) with a strict timeout and
 * bounded output buffers so untrusted media or paths can never trigger shell injection
 * or hang the worker indefinitely.
 */
function execBinary(
  binaryPath: string,
  args: string[],
  timeoutMs: number,
  encoding: "utf8" | "buffer" = "utf8"
): Promise<{ stdout: string | Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const effectiveTimeout = Math.max(50, Math.floor(timeoutMs));
    execFile(
      binaryPath,
      args,
      {
        timeout: effectiveTimeout,
        killSignal: "SIGKILL",
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        encoding: encoding === "buffer" ? "buffer" : "utf8",
      },
      (error, stdout, stderr) => {
        const stderrStr = Buffer.isBuffer(stderr)
          ? stderr.toString("utf8")
          : String(stderr ?? "");
        if (error) {
          const isTimeout =
            error.killed ||
            error.signal === "SIGKILL" ||
            error.signal === "SIGTERM" ||
            String(error.message).toLowerCase().includes("timed out") ||
            (error as NodeJS.ErrnoException).code === "ETIMEDOUT";
          if (isTimeout) {
            reject(new Error("Render job exceeded timeout limit during media processing."));
            return;
          }
          reject(
            new Error(
              `Media processor error: ${stderrStr.slice(-400) || error.message}`
            )
          );
          return;
        }
        resolve({
          stdout: stdout as string | Buffer,
          stderr: stderrStr,
        });
      }
    );
  });
}

interface FfprobeRawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  duration?: string | number;
}

interface FfprobeRawFormat {
  format_name?: string;
  duration?: string | number;
  size?: string | number;
}

interface FfprobeRawOutput {
  streams?: FfprobeRawStream[];
  format?: FfprobeRawFormat;
}

/**
 * Inspects a local media file using `ffprobe` to verify binary container format,
 * video/audio stream presence, codec names, dimensions, and actual duration.
 */
export async function probeMediaFile(
  filePath: string,
  options?: {
    ffprobePath?: string;
    timeoutMs?: number;
  }
): Promise<ProbedMediaInfo> {
  const stats = await fs.stat(filePath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error("Media file is empty or does not exist.");
  }

  const { ffprobePath } = resolveFfmpegBinaries();
  const binary = options?.ffprobePath || ffprobePath;
  const timeoutMs = options?.timeoutMs ?? 15_000;

  const { stdout } = await execBinary(
    binary,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    timeoutMs,
    "utf8"
  );

  let parsed: FfprobeRawOutput;
  try {
    parsed = JSON.parse(String(stdout)) as FfprobeRawOutput;
  } catch {
    throw new Error("Corrupt or unreadable media metadata from ffprobe.");
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  if (!videoStream || !videoStream.codec_name) {
    throw new Error("Media file does not contain a valid video stream.");
  }

  const audioStream = streams.find((s) => s.codec_type === "audio");

  const rawDuration =
    videoStream.duration !== undefined && videoStream.duration !== "N/A"
      ? Number(videoStream.duration)
      : Number(parsed.format?.duration);

  const durationSeconds = Number.isFinite(rawDuration) ? rawDuration : 0;
  const width = typeof videoStream.width === "number" ? videoStream.width : 0;
  const height = typeof videoStream.height === "number" ? videoStream.height : 0;

  return {
    filePath,
    sizeBytes: stats.size,
    formatName: parsed.format?.format_name || "unknown",
    durationSeconds,
    videoCodec: videoStream.codec_name.toLowerCase(),
    width,
    height,
    pixelFormat: videoStream.pix_fmt || "unknown",
    hasAudio: Boolean(audioStream?.codec_name),
    audioCodec: audioStream?.codec_name ? audioStream.codec_name.toLowerCase() : null,
  };
}

/**
 * Validates a probed video clip against explicit HIHA worker safety and compatibility limits.
 */
export function validateProbedClip(
  probe: ProbedMediaInfo,
  limits: RenderWorkerLimits = DEFAULT_RENDER_WORKER_LIMITS
): ClipValidationResult {
  if (probe.sizeBytes <= 0) {
    return { valid: false, error: "Source clip file is empty." };
  }

  if (probe.sizeBytes > limits.maxClipSizeBytes) {
    return {
      valid: false,
      error: `Source clip exceeds maximum allowed byte size (${limits.maxClipSizeBytes} bytes).`,
    };
  }

  if (!limits.allowedVideoCodecs.includes(probe.videoCodec)) {
    return {
      valid: false,
      error: `Unsupported video codec '${probe.videoCodec}'. Allowed codecs: ${limits.allowedVideoCodecs.join(", ")}.`,
    };
  }

  if (
    !Number.isInteger(probe.width) ||
    !Number.isInteger(probe.height) ||
    probe.width < limits.minDimensionPx ||
    probe.height < limits.minDimensionPx ||
    probe.width > limits.maxDimensionPx ||
    probe.height > limits.maxDimensionPx
  ) {
    return {
      valid: false,
      error: `Invalid video dimensions (${probe.width}x${probe.height}). Allowed range: ${limits.minDimensionPx}px–${limits.maxDimensionPx}px.`,
    };
  }

  if (
    !Number.isFinite(probe.durationSeconds) ||
    probe.durationSeconds < limits.minClipDurationSeconds ||
    probe.durationSeconds > limits.maxClipDurationSeconds
  ) {
    return {
      valid: false,
      error: `Invalid video duration (${probe.durationSeconds.toFixed(2)}s). Allowed range: ${limits.minClipDurationSeconds}s–${limits.maxClipDurationSeconds}s.`,
    };
  }

  return { valid: true };
}

/**
 * Extracts the average RGB color `[r, g, b]` of a frame at `timestampSeconds`
 * from a video file using FFmpeg. Used in end-to-end verification tests to prove
 * that clips were concatenated in the exact approved sequence order.
 */
export async function probeVideoFrameRgb(
  filePath: string,
  timestampSeconds: number,
  options?: {
    ffmpegPath?: string;
    timeoutMs?: number;
  }
): Promise<[number, number, number]> {
  const { ffmpegPath } = resolveFfmpegBinaries();
  const binary = options?.ffmpegPath || ffmpegPath;
  const timeoutMs = options?.timeoutMs ?? 15_000;

  const { stdout } = await execBinary(
    binary,
    [
      "-v",
      "error",
      "-ss",
      Math.max(0, timestampSeconds).toFixed(2),
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    timeoutMs,
    "buffer"
  );

  const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout), "binary");
  if (buf.length < 3) {
    throw new Error("Unable to extract video frame RGB sample.");
  }

  return [buf[0]!, buf[1]!, buf[2]!];
}

/**
 * Generates a real, playable synthetic MP4 video clip using FFmpeg's `lavfi`
 * color and optional sine-wave audio sources. Used for deterministic local and
 * live integration verification of the rendering pipeline.
 */
export async function generateSyntheticVideoClip(
  outputPath: string,
  options?: {
    color?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    fps?: number;
    withAudio?: boolean;
    audioFreqHz?: number;
    ffmpegPath?: string;
    timeoutMs?: number;
  }
): Promise<Buffer> {
  const { ffmpegPath } = resolveFfmpegBinaries();
  const binary = options?.ffmpegPath || ffmpegPath;
  const color = options?.color ?? "red";
  const width = options?.width ?? 320;
  const height = options?.height ?? 240;
  const durationSeconds = options?.durationSeconds ?? 1.2;
  const fps = options?.fps ?? 24;
  const withAudio = options?.withAudio ?? true;
  const audioFreqHz = options?.audioFreqHz ?? 440;
  const timeoutMs = options?.timeoutMs ?? 20_000;

  const args: string[] = [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}:d=${durationSeconds}:r=${fps}`,
  ];

  if (withAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${audioFreqHz}:sample_rate=44100:duration=${durationSeconds}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outputPath
    );
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath
    );
  }

  await execBinary(binary, args, timeoutMs, "utf8");
  return fs.readFile(outputPath);
}

/**
 * Escapes a file path for an FFmpeg concat demuxer list file (`file '...'`).
 */
function formatConcatDemuxerPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const escaped = normalized.replace(/'/g, "'\\''");
  return `file '${escaped}'`;
}

/**
 * Normalizes and concatenates a sequence of validated input clips into a single
 * playable MP4 file (`outputPath`).
 *
 * Compatibility Re-encoding Strategy:
 * - Contributor clips frequently differ in resolution, aspect ratio, frame rate,
 *   pixel format, video codec (H.264/VP8/VP9/MPEG-4), or audio track presence.
 * - Direct stream-copy (`-c copy`) across heterogeneous clips produces broken
 *   or unplayable containers.
 * - Each input clip is first normalized into a canonical intermediate segment:
 *   `H.264 (yuv420p)` at `targetWidth x targetHeight @ targetFps` with aspect-ratio-preserving
 *   padding, paired with a `44.1 kHz stereo AAC` audio stream (synthesizing silent
 *   `anullsrc` audio when a source clip has no audio track).
 * - The normalized segments are then concatenated in exact sequence order using
 *   FFmpeg's `concat` demuxer with `-movflags +faststart`, and the resulting output
 *   is verified with `ffprobe`.
 */
export async function concatenateValidatedClips(
  inputClips: ProbedMediaInfo[],
  outputPath: string,
  limits: RenderWorkerLimits = DEFAULT_RENDER_WORKER_LIMITS,
  options?: {
    workDir?: string;
    ffmpegPath?: string;
    ffprobePath?: string;
    deadlineMs?: number;
  }
): Promise<ProbedMediaInfo> {
  if (inputClips.length === 0) {
    throw new Error("Cannot concatenate an empty clip list.");
  }

  const { ffmpegPath, ffprobePath } = resolveFfmpegBinaries();
  const ffmpegBin = options?.ffmpegPath || ffmpegPath;
  const ffprobeBin = options?.ffprobePath || ffprobePath;
  const workDir = options?.workDir || path.dirname(outputPath);
  const deadlineMs =
    options?.deadlineMs ?? Date.now() + limits.processTimeoutMs;

  const getRemainingTimeoutMs = () => {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      throw new Error("Render job exceeded timeout limit.");
    }
    return remaining;
  };

  let totalInputDuration = 0;
  for (const clip of inputClips) {
    const check = validateProbedClip(clip, limits);
    if (!check.valid) {
      throw new Error(check.error || "Invalid input clip.");
    }
    totalInputDuration += clip.durationSeconds;
  }

  if (totalInputDuration > limits.maxTotalDurationSeconds) {
    throw new Error(
      `Combined video duration (${totalInputDuration.toFixed(1)}s) exceeds limit (${limits.maxTotalDurationSeconds}s).`
    );
  }

  const normalizedPaths: string[] = [];
  const vfFilter = [
    `scale=${limits.targetWidth}:${limits.targetHeight}:force_original_aspect_ratio=decrease`,
    `pad=${limits.targetWidth}:${limits.targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    `fps=${limits.targetFps}`,
    "format=yuv420p",
  ].join(",");

  for (let i = 0; i < inputClips.length; i++) {
    const clip = inputClips[i]!;
    const normPath = path.join(
      workDir,
      `norm_${String(i + 1).padStart(4, "0")}.mp4`
    );

    const args: string[] = ["-y", "-v", "error", "-i", clip.filePath];

    if (clip.hasAudio) {
      args.push(
        "-vf",
        vfFilter,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        normPath
      );
    } else {
      args.push(
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf",
        vfFilter,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        normPath
      );
    }

    await execBinary(ffmpegBin, args, getRemainingTimeoutMs(), "utf8");
    normalizedPaths.push(normPath);
  }

  const concatListPath = path.join(workDir, "concat_list.txt");
  const concatListContent = normalizedPaths
    .map((p) => formatConcatDemuxerPath(p))
    .join("\n");
  await fs.writeFile(concatListPath, concatListContent, "utf8");

  await execBinary(
    ffmpegBin,
    [
      "-y",
      "-v",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    getRemainingTimeoutMs(),
    "utf8"
  );

  const outputProbe = await probeMediaFile(outputPath, {
    ffprobePath: ffprobeBin,
    timeoutMs: getRemainingTimeoutMs(),
  });

  if (
    outputProbe.sizeBytes <= 0 ||
    outputProbe.videoCodec !== "h264" ||
    outputProbe.width !== limits.targetWidth ||
    outputProbe.height !== limits.targetHeight ||
    outputProbe.durationSeconds < Math.max(0.1, totalInputDuration * 0.7)
  ) {
    throw new Error("Stitched output video failed post-render integrity verification.");
  }

  return outputProbe;
}

/**
 * Cleans up any orphaned `hiha-render-*` temporary directories in `baseTmpDir`
 * older than `maxAgeMs`.
 */
export async function cleanupOrphanedRenderTempDirs(
  maxAgeMs: number = 15 * 60 * 1000,
  baseTmpDir: string = os.tmpdir()
): Promise<number> {
  let cleanedCount = 0;
  try {
    const entries = await fs.readdir(baseTmpDir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(TEMP_DIR_PREFIX)) {
        const fullPath = path.join(baseTmpDir, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          if (maxAgeMs <= 0 || now - stat.mtimeMs >= maxAgeMs) {
            await fs.rm(fullPath, { recursive: true, force: true });
            cleanedCount++;
          }
        } catch {
          // Ignore concurrent removal
        }
      }
    }
  } catch {
    // Ignore directory scan errors
  }
  return cleanedCount;
}

/**
 * Sanitizes internal worker errors into safe, user-facing failure reasons
 * without leaking local filesystem paths or stack traces.
 */
export function sanitizeWorkerFailureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();

  if (lower.includes("timeout")) {
    return "Render job failed: processing exceeded the allowed timeout limit.";
  }
  if (lower.includes("consent") || lower.includes("withdrawn")) {
    return "Render aborted: contributor consent was withdrawn or modified.";
  }
  if (lower.includes("cancelled") || lower.includes("no longer in rendering state")) {
    return "Render aborted: project was cancelled or is no longer in rendering state.";
  }
  if (lower.includes("unsupported video codec")) {
    return raw;
  }
  if (lower.includes("invalid video dimensions") || lower.includes("invalid video duration")) {
    return raw;
  }
  if (lower.includes("exceeds maximum allowed byte size") || lower.includes("combined video duration")) {
    return raw;
  }
  if (
    lower.includes("corrupt") ||
    lower.includes("valid video stream") ||
    lower.includes("media processor error") ||
    lower.includes("empty")
  ) {
    return "Render failed: one or more source clips are corrupt, unreadable, or not a valid video container.";
  }
  if (lower.includes("download") || lower.includes("storage") || lower.includes("accessible")) {
    return "Render failed: one or more source clips could not be accessed in private storage.";
  }

  return "Render job failed during media validation or video stitching.";
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX8_REGEX = /^[0-9a-f]{8}$/i;

export interface WorkerRuntimeConfig {
  supabaseUrl: string;
  supabaseKey: string;
  workerEmail: string;
  workerPassword: string;
  jobId?: string;
  isPoll: boolean;
  intervalMs: number;
}

function parseCliArg(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) {
    const val = argv[idx + 1];
    if (val && !val.startsWith("--")) {
      return val;
    }
  }
  return undefined;
}

/**
 * Resolves and validates the background render worker's runtime configuration.
 * Fails closed with a clear, non-secret error if Supabase URL/key or worker
 * credentials (`RENDER_WORKER_EMAIL` / `--email`, `RENDER_WORKER_PASSWORD` / `--password`)
 * are missing or invalid. Never falls back to default or test accounts.
 */
export function resolveWorkerRuntimeConfig(
  rawEnv: Record<string, string | undefined> = process.env,
  argv: readonly string[] = []
): WorkerRuntimeConfig {
  const supabaseUrl = rawEnv.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseKey = (
    rawEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    rawEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing required worker configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be set."
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error(
      "Invalid worker configuration: NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP/HTTPS URL."
    );
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(
      "Invalid worker configuration: NEXT_PUBLIC_SUPABASE_URL must use http: or https: protocol."
    );
  }

  const workerEmail = (
    parseCliArg(argv, "--email") ??
    rawEnv.RENDER_WORKER_EMAIL ??
    ""
  ).trim();
  const workerPassword = (
    parseCliArg(argv, "--password") ??
    rawEnv.RENDER_WORKER_PASSWORD ??
    ""
  ).trim();

  if (!workerEmail || !workerPassword) {
    throw new Error(
      "Missing required worker credentials: RENDER_WORKER_EMAIL (or --email) and RENDER_WORKER_PASSWORD (or --password) must be explicitly provided. Default or test fallback accounts are prohibited."
    );
  }

  if (!workerEmail.includes("@") || workerEmail.startsWith("@") || workerEmail.endsWith("@")) {
    throw new Error(
      "Invalid worker configuration: RENDER_WORKER_EMAIL must be a valid email address."
    );
  }

  const jobId = parseCliArg(argv, "--job-id")?.trim();
  if (jobId && !UUID_REGEX.test(jobId)) {
    throw new Error(
      "Invalid worker configuration: --job-id must be a valid UUID."
    );
  }

  const isPoll = argv.includes("--poll");
  const rawInterval = Number(parseCliArg(argv, "--interval-ms") || "5000");
  const intervalMs = Number.isFinite(rawInterval)
    ? Math.max(1000, Math.floor(rawInterval))
    : 5000;

  return {
    supabaseUrl,
    supabaseKey,
    workerEmail,
    workerPassword,
    jobId: jobId || undefined,
    isPoll,
    intervalMs,
  };
}

/**
 * Builds the canonical private storage path for a rendered collaborative project output:
 * `{projectCreatorId}/stitched-{projectId}-{jobId}-{hex8}.mp4`
 */
export function buildCanonicalRenderOutputPath(
  projectCreatorId: string,
  projectId: string,
  jobId: string,
  suffixHex?: string
): string {
  const cleanCreatorId = projectCreatorId.trim().toLowerCase();
  const cleanProjectId = projectId.trim().toLowerCase();
  const cleanJobId = jobId.trim().toLowerCase();

  if (
    !UUID_REGEX.test(cleanCreatorId) ||
    !UUID_REGEX.test(cleanProjectId) ||
    !UUID_REGEX.test(cleanJobId)
  ) {
    throw new Error(
      "Cannot build render output path: projectCreatorId, projectId, and jobId must be valid UUIDs."
    );
  }

  const resolvedSuffix = (
    suffixHex ?? randomUUID().replace(/-/g, "").slice(0, 8)
  )
    .trim()
    .toLowerCase();

  if (!HEX8_REGEX.test(resolvedSuffix)) {
    throw new Error(
      "Cannot build render output path: suffixHex must be an 8-character hexadecimal string."
    );
  }

  return `${cleanCreatorId}/stitched-${cleanProjectId}-${cleanJobId}-${resolvedSuffix}.mp4`;
}

/**
 * Validates that an output object path strictly matches the canonical format
 * `{projectCreatorId}/stitched-{projectId}-{jobId}-{hex8}.mp4` with no path traversal.
 */
export function isCanonicalRenderOutputPath(
  objectPath: string,
  projectCreatorId: string,
  projectId: string,
  jobId: string
): boolean {
  if (
    !objectPath ||
    objectPath.includes("..") ||
    objectPath.includes("\\") ||
    objectPath.startsWith("/")
  ) {
    return false;
  }

  const cleanCreatorId = projectCreatorId.trim().toLowerCase();
  const cleanProjectId = projectId.trim().toLowerCase();
  const cleanJobId = jobId.trim().toLowerCase();

  if (
    !UUID_REGEX.test(cleanCreatorId) ||
    !UUID_REGEX.test(cleanProjectId) ||
    !UUID_REGEX.test(cleanJobId)
  ) {
    return false;
  }

  const expectedPrefix = `${cleanCreatorId}/stitched-${cleanProjectId}-${cleanJobId}-`;
  const normalizedPath = objectPath.toLowerCase();
  if (!normalizedPath.startsWith(expectedPrefix) || !normalizedPath.endsWith(".mp4")) {
    return false;
  }

  const suffix = normalizedPath.slice(
    expectedPrefix.length,
    normalizedPath.length - ".mp4".length
  );
  return HEX8_REGEX.test(suffix) && !suffix.includes("/");
}

/**
 * Verifies that a contribution media path belongs to the declared contributor's
 * top-level private storage folder (`{contributorId}/{fileName}`) with no traversal.
 */
export function isAuthorizedContributionMediaPath(
  mediaPath: string,
  contributorId: string
): boolean {
  if (
    !mediaPath ||
    !contributorId ||
    !UUID_REGEX.test(contributorId) ||
    mediaPath.includes("..") ||
    mediaPath.includes("\\") ||
    mediaPath.startsWith("/")
  ) {
    return false;
  }

  const segments = mediaPath.split("/");
  if (segments.length !== 2) {
    return false;
  }

  const [folderOwnerId, fileName] = segments;
  if (!folderOwnerId || !fileName || fileName.trim().length === 0) {
    return false;
  }

  return folderOwnerId.toLowerCase() === contributorId.trim().toLowerCase();
}

export interface ProcessRenderJobOptions {
  jobId?: string;
  limits?: Partial<RenderWorkerLimits>;
  /**
   * Optional hook invoked after the job is claimed (`status = 'processing'`)
   * and before clips are downloaded. Useful in tests to simulate concurrent
   * consent withdrawal, participant removal, or project cancellation.
   */
  onAfterClaim?: (job: ProjectRenderJob) => Promise<void>;
  /**
   * Optional hook invoked after local FFmpeg concatenation succeeds and right
   * before re-validating consent and committing completion to Supabase.
   */
  onBeforeCommit?: (job: ProjectRenderJob, localOutputProbe: ProbedMediaInfo) => Promise<void>;
}

export interface ProcessRenderJobResult {
  claimed: boolean;
  jobId: string | null;
  projectId: string | null;
  status: "completed" | "failed" | "skipped";
  outputMediaPath: string | null;
  outputProbe: ProbedMediaInfo | null;
  failureReason: string | null;
  tempDirCleanedUp: boolean;
}

/**
 * Claims and executes a durable collaborative video render job end-to-end:
 * 1. Atomically claims a `'queued'` job via `claim_project_render_job` (`FOR UPDATE SKIP LOCKED`).
 * 2. Verifies project state (`rendering`) and authoritative ordered `input_manifest`.
 * 3. Re-verifies every contribution's active consent, approval, and storage authorization.
 * 4. Downloads authorized clips into an isolated temporary workspace.
 * 5. Probes and validates every clip with `ffprobe` (codec, dimensions, duration, byte size).
 * 6. Normalizes and concatenates clips in `sequence_order` using `ffmpeg` and verifies the output.
 * 7. Re-validates consent and project status before uploading and committing completion.
 * 8. Uploads the stitched MP4 to private storage (`media`) under the canonical project owner path and marks the job `'completed'`.
 * 9. Rolls back any uploaded storage object if commit fails due to a concurrent consent withdrawal or cancellation.
 * 10. Always removes temporary files on success, failure, cancellation, or timeout.
 */
export async function processProjectRenderJob(
  supabase: SupabaseClient<Database>,
  actorUserId: string,
  options?: ProcessRenderJobOptions
): Promise<ProcessRenderJobResult> {
  if (!actorUserId || !UUID_REGEX.test(actorUserId.trim())) {
    return {
      claimed: false,
      jobId: options?.jobId ?? null,
      projectId: null,
      status: "skipped",
      outputMediaPath: null,
      outputProbe: null,
      failureReason: "Unauthorized worker: valid authenticated worker user ID is required.",
      tempDirCleanedUp: true,
    };
  }

  const normalizedActorUserId = actorUserId.trim();
  const limits: RenderWorkerLimits = {
    ...DEFAULT_RENDER_WORKER_LIMITS,
    ...options?.limits,
  };

  let claimedJob: ProjectRenderJob | null = null;
  let tempDir: string | null = null;
  let uploadedOutputPath: string | null = null;

  // Step 1: Atomically claim queued job using FOR UPDATE SKIP LOCKED
  const { data: claimedRows, error: claimErr } = await supabase.rpc(
    "claim_project_render_job",
    {
      p_job_id: options?.jobId ?? null,
    }
  );

  if (claimErr) {
    const rawClaimMsg = claimErr.message || "";
    const isUnauthorizedClaim =
      rawClaimMsg.toLowerCase().includes("not authorized to claim") ||
      rawClaimMsg.toLowerCase().includes("unauthorized");

    // If claiming a specific queued job threw a manifest/consent integrity exception (and not an auth rejection),
    // mark that invalid queued job as failed so it does not remain stuck in 'queued'.
    if (options?.jobId && !isUnauthorizedClaim) {
      const safeReason = sanitizeWorkerFailureReason(rawClaimMsg);
      const { error: failRpcErr } = await supabase.rpc(
        "fail_invalid_queued_render_job",
        {
          p_job_id: options.jobId,
          p_failure_reason: safeReason,
        }
      );

      if (failRpcErr) {
        await supabase
          .from("project_render_jobs")
          .update({
            status: "failed",
            failure_reason: safeReason,
          })
          .eq("id", options.jobId)
          .eq("status", "queued");
      }

      return {
        claimed: false,
        jobId: options.jobId,
        projectId: null,
        status: "failed",
        outputMediaPath: null,
        outputProbe: null,
        failureReason: safeReason,
        tempDirCleanedUp: true,
      };
    }

    return {
      claimed: false,
      jobId: options?.jobId ?? null,
      projectId: null,
      status: "skipped",
      outputMediaPath: null,
      outputProbe: null,
      failureReason: isUnauthorizedClaim
        ? "Unauthorized: actor is not an active render worker or authorized project editor."
        : sanitizeWorkerFailureReason(rawClaimMsg),
      tempDirCleanedUp: true,
    };
  }

  if (!claimedRows || claimedRows.length === 0) {
    return {
      claimed: false,
      jobId: options?.jobId ?? null,
      projectId: null,
      status: "skipped",
      outputMediaPath: null,
      outputProbe: null,
      failureReason: null,
      tempDirCleanedUp: true,
    };
  }

  claimedJob = claimedRows[0]!;
  const effectiveTimeoutMs = Math.min(
    claimedJob.timeout_seconds * 1000,
    limits.processTimeoutMs
  );
  const deadlineMs = Date.now() + effectiveTimeoutMs;

  const ensureWithinDeadline = () => {
    if (Date.now() >= deadlineMs) {
      throw new Error("Render job exceeded timeout limit.");
    }
  };

  const cleanupTempDir = async (): Promise<boolean> => {
    if (!tempDir) return true;
    const target = tempDir;
    tempDir = null;
    try {
      await fs.rm(target, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };

  try {
    if (
      claimedJob.claimed_by &&
      claimedJob.claimed_by.toLowerCase() !== normalizedActorUserId.toLowerCase()
    ) {
      throw new Error("Render job claim ownership mismatch.");
    }

    if (options?.onAfterClaim) {
      await options.onAfterClaim(claimedJob);
    }

    ensureWithinDeadline();

    // Step 2: Verify project state & load authoritative manifest
    const { data: project, error: projErr } = await supabase
      .from("collaborative_projects")
      .select("id, creator_id, status, consent_policy_version")
      .eq("id", claimedJob.project_id)
      .maybeSingle();

    if (projErr || !project || project.status !== "rendering") {
      throw new Error(
        "Project is no longer in rendering state or was cancelled."
      );
    }

    const rawManifest = (claimedJob.input_manifest ?? []) as RenderManifestItem[];
    const manifestValidation = validateAndOrderRenderManifest(
      rawManifest,
      project.consent_policy_version || CURRENT_CONSENT_POLICY_VERSION
    );

    if (!manifestValidation.valid) {
      throw new Error(manifestValidation.error || "Invalid render manifest.");
    }

    const orderedManifest = manifestValidation.orderedManifest;
    if (orderedManifest.length > limits.maxClipsPerJob) {
      throw new Error(
        `Render manifest exceeds maximum allowed clips per job (${limits.maxClipsPerJob}).`
      );
    }

    // Step 3: Confirm every contribution in the manifest remains approved, consented, and eligible
    const contributionIds = orderedManifest.map((item) => item.contribution_id);
    const { data: liveContributions, error: contribErr } = await supabase
      .from("project_contributions")
      .select(
        "id, project_id, contributor_id, media_path, media_type, review_status, consent_granted, consent_withdrawn_at, consent_policy_version, sequence_order"
      )
      .eq("project_id", claimedJob.project_id)
      .in("id", contributionIds);

    if (
      contribErr ||
      !liveContributions ||
      liveContributions.length !== orderedManifest.length
    ) {
      throw new Error(
        "One or more contributions in the manifest lost consent or eligibility."
      );
    }

    const contribById = new Map(liveContributions.map((c) => [c.id, c]));
    for (const item of orderedManifest) {
      const live = contribById.get(item.contribution_id);
      if (
        !live ||
        live.review_status !== "approved" ||
        live.consent_granted !== true ||
        live.consent_withdrawn_at !== null ||
        live.contributor_id !== item.contributor_id ||
        live.media_path !== item.media_path ||
        !isAuthorizedContributionMediaPath(item.media_path, item.contributor_id) ||
        live.consent_policy_version !== project.consent_policy_version
      ) {
        throw new Error(
          "One or more contributions in the manifest lost consent or approval."
        );
      }
    }

    // Step 4: Create isolated temporary workspace directory
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${TEMP_DIR_PREFIX}${claimedJob.id.slice(0, 8)}-`)
    );

    // Step 5: Securely download and probe each clip in sequence order
    const probedClips: ProbedMediaInfo[] = [];
    let totalBytesDownloaded = 0;

    for (let i = 0; i < orderedManifest.length; i++) {
      ensureWithinDeadline();
      const item = orderedManifest[i]!;

      // Issue a short-lived signed URL to verify storage.objects RLS in real time (avoiding any GET CDN cache)
      const { data: signedData, error: signErr } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(item.media_path, 60);

      if (signErr || !signedData?.signedUrl) {
        throw new Error(
          `Source clip is not accessible in private storage (${item.contribution_id}).`
        );
      }

      const response = await fetch(signedData.signedUrl, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Failed to download source clip (${response.status}).`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const clipBuffer = Buffer.from(arrayBuffer);

      if (clipBuffer.byteLength <= 0) {
        throw new Error("Downloaded source clip is empty.");
      }

      if (clipBuffer.byteLength > limits.maxClipSizeBytes) {
        throw new Error(
          `Source clip exceeds maximum allowed byte size (${limits.maxClipSizeBytes} bytes).`
        );
      }

      totalBytesDownloaded += clipBuffer.byteLength;
      if (totalBytesDownloaded > limits.maxTotalInputBytes) {
        throw new Error(
          `Total input media size exceeds maximum allowed limit (${limits.maxTotalInputBytes} bytes).`
        );
      }

      const ext = path.extname(item.media_path).replace(/[^.a-zA-Z0-9]/g, "") || ".mp4";
      const localClipPath = path.join(
        tempDir,
        `clip_${String(i + 1).padStart(4, "0")}${ext}`
      );

      // Verify path containment inside tempDir
      const resolvedLocalClipPath = path.resolve(localClipPath);
      const resolvedTempDir = path.resolve(tempDir);
      if (!resolvedLocalClipPath.startsWith(resolvedTempDir + path.sep)) {
        throw new Error("Security violation: temporary clip path escaped workspace.");
      }

      await fs.writeFile(resolvedLocalClipPath, clipBuffer);

      const probe = await probeMediaFile(resolvedLocalClipPath, {
        timeoutMs: Math.max(50, deadlineMs - Date.now()),
      });

      const validation = validateProbedClip(probe, limits);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid source clip.");
      }

      probedClips.push(probe);
    }

    ensureWithinDeadline();

    // Step 6: Concatenate normalized clips into playable MP4 output
    const localOutputPath = path.join(tempDir, "stitched_output.mp4");
    const outputProbe = await concatenateValidatedClips(
      probedClips,
      localOutputPath,
      limits,
      {
        workDir: tempDir,
        deadlineMs,
      }
    );

    if (options?.onBeforeCommit) {
      await options.onBeforeCommit(claimedJob, outputProbe);
    }

    ensureWithinDeadline();

    // Step 7: Re-verify job status, project status, and contributor consent BEFORE uploading output
    const [recheckJobRes, recheckProjRes, recheckContribsRes] = await Promise.all([
      supabase
        .from("project_render_jobs")
        .select("id, status")
        .eq("id", claimedJob.id)
        .maybeSingle(),
      supabase
        .from("collaborative_projects")
        .select("id, status")
        .eq("id", claimedJob.project_id)
        .maybeSingle(),
      supabase
        .from("project_contributions")
        .select("id, review_status, consent_granted, consent_withdrawn_at")
        .eq("project_id", claimedJob.project_id)
        .in("id", contributionIds),
    ]);

    if (
      recheckJobRes.data?.status !== "processing" ||
      recheckProjRes.data?.status !== "rendering"
    ) {
      throw new Error(
        "Render aborted: contributor consent was withdrawn or project was cancelled during rendering."
      );
    }

    if (
      !recheckContribsRes.data ||
      recheckContribsRes.data.length !== orderedManifest.length ||
      recheckContribsRes.data.some(
        (c) =>
          c.review_status !== "approved" ||
          c.consent_granted !== true ||
          c.consent_withdrawn_at !== null
      )
    ) {
      throw new Error(
        "Render aborted: contributor consent was withdrawn during rendering."
      );
    }

    // Step 8: Upload stitched output to private 'media' bucket under canonical project owner scope
    const outputStoragePath = buildCanonicalRenderOutputPath(
      project.creator_id,
      claimedJob.project_id,
      claimedJob.id
    );
    if (
      !isCanonicalRenderOutputPath(
        outputStoragePath,
        project.creator_id,
        claimedJob.project_id,
        claimedJob.id
      )
    ) {
      throw new Error("Security violation: invalid canonical render output path.");
    }

    const outputBytes = await fs.readFile(localOutputPath);

    const { error: uploadErr } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(outputStoragePath, outputBytes, {
        contentType: "video/mp4",
        cacheControl: "0",
        upsert: false,
      });

    if (uploadErr) {
      throw new Error(`Failed to upload stitched output to private storage: ${uploadErr.message}`);
    }

    uploadedOutputPath = outputStoragePath;

    // Step 9: Commit completion transactionally in PostgreSQL (which re-runs validate_render_job_manifest_integrity in trigger)
    const { data: completedJob, error: completeErr } = await supabase
      .from("project_render_jobs")
      .update({
        status: "completed",
        output_media_path: outputStoragePath,
      })
      .eq("id", claimedJob.id)
      .eq("status", "processing")
      .select("id, status, output_media_path")
      .maybeSingle();

    if (completeErr || !completedJob || completedJob.status !== "completed") {
      // Immediately remove the uploaded file so a failed/aborted render NEVER leaves an exposed object
      await supabase.storage.from(MEDIA_BUCKET).remove([outputStoragePath]);
      uploadedOutputPath = null;
      throw new Error(
        completeErr?.message ||
          "Render completion rejected: contributor consent or project status changed prior to commit."
      );
    }

    const cleaned = await cleanupTempDir();
    return {
      claimed: true,
      jobId: claimedJob.id,
      projectId: claimedJob.project_id,
      status: "completed",
      outputMediaPath: outputStoragePath,
      outputProbe,
      failureReason: null,
      tempDirCleanedUp: cleaned,
    };
  } catch (err: unknown) {
    // Clean up any uploaded output file if failure occurred after upload
    if (uploadedOutputPath) {
      try {
        await supabase.storage.from(MEDIA_BUCKET).remove([uploadedOutputPath]);
      } catch {
        // Ignore cleanup error
      }
      uploadedOutputPath = null;
    }

    const safeReason = sanitizeWorkerFailureReason(err);

    // Transition job to 'failed' if it is still in 'processing' or 'queued' state
    // (Note: if a concurrent consent withdrawal or project cancellation trigger already marked it 'failed', this is a safe no-op)
    try {
      await supabase
        .from("project_render_jobs")
        .update({
          status: "failed",
          failure_reason: safeReason,
        })
        .eq("id", claimedJob.id)
        .in("status", ["queued", "processing"]);
    } catch {
      // Ignore if already transitioned by database trigger
    }

    const cleaned = await cleanupTempDir();
    return {
      claimed: true,
      jobId: claimedJob.id,
      projectId: claimedJob.project_id,
      status: "failed",
      outputMediaPath: null,
      outputProbe: null,
      failureReason: safeReason,
      tempDirCleanedUp: cleaned,
    };
  } finally {
    await cleanupTempDir();
  }
}
