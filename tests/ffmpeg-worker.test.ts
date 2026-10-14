import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupOrphanedRenderTempDirs,
  concatenateValidatedClips,
  DEFAULT_RENDER_WORKER_LIMITS,
  generateSyntheticVideoClip,
  probeMediaFile,
  probeVideoFrameRgb,
  resolveFfmpegBinaries,
  sanitizeWorkerFailureReason,
  TEMP_DIR_PREFIX,
  validateProbedClip,
} from "@/lib/collaboration/ffmpeg-worker";
import {
  ContractQueueStitchingAdapter,
  createStitchingProvider,
  FfmpegWorkerQueueAdapter,
} from "@/lib/collaboration/render-provider";

describe("Milestone 4.2A: Real FFmpeg Video Rendering Processor", () => {
  const createdDirs: string[] = [];

  async function makeWorkDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hiha-vitest-ffmpeg-"));
    createdDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it("resolves working ffmpeg and ffprobe binaries and synthesizes playable video clips", async () => {
    const binaries = resolveFfmpegBinaries();
    expect(binaries.ffmpegPath).toBeTruthy();
    expect(binaries.ffprobePath).toBeTruthy();

    const dir = await makeWorkDir();
    const clipPath = path.join(dir, "sample.mp4");
    await generateSyntheticVideoClip(clipPath, {
      color: "red",
      width: 320,
      height: 240,
      durationSeconds: 1.0,
      withAudio: true,
    });

    const probe = await probeMediaFile(clipPath);
    expect(probe.videoCodec).toBe("h264");
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationSeconds).toBeGreaterThanOrEqual(0.8);
    expect(probe.durationSeconds).toBeLessThanOrEqual(1.3);

    const validation = validateProbedClip(probe);
    expect(validation.valid).toBe(true);
  }, 30_000);

  it("concatenates heterogeneous clips (different resolutions and audio presence) in exact sequence order", async () => {
    const dir = await makeWorkDir();
    const clipRedPath = path.join(dir, "clip_red.mp4");
    const clipBluePath = path.join(dir, "clip_blue.mp4");

    // Clip 1: 320x240 RED with audio (1.2s)
    await generateSyntheticVideoClip(clipRedPath, {
      color: "red",
      width: 320,
      height: 240,
      durationSeconds: 1.2,
      withAudio: true,
    });

    // Clip 2: 480x360 BLUE silent video-only (1.4s)
    await generateSyntheticVideoClip(clipBluePath, {
      color: "blue",
      width: 480,
      height: 360,
      durationSeconds: 1.4,
      withAudio: false,
    });

    const probeRed = await probeMediaFile(clipRedPath);
    const probeBlue = await probeMediaFile(clipBluePath);
    expect(probeRed.hasAudio).toBe(true);
    expect(probeBlue.hasAudio).toBe(false);

    // Order A: Red (#1) -> Blue (#2)
    const outRedFirst = path.join(dir, "out_red_first.mp4");
    const stitchedProbe1 = await concatenateValidatedClips(
      [probeRed, probeBlue],
      outRedFirst,
      DEFAULT_RENDER_WORKER_LIMITS,
      { workDir: dir }
    );

    expect(stitchedProbe1.videoCodec).toBe("h264");
    expect(stitchedProbe1.hasAudio).toBe(true);
    expect(stitchedProbe1.width).toBe(DEFAULT_RENDER_WORKER_LIMITS.targetWidth);
    expect(stitchedProbe1.height).toBe(DEFAULT_RENDER_WORKER_LIMITS.targetHeight);
    expect(stitchedProbe1.durationSeconds).toBeGreaterThanOrEqual(2.3);
    expect(stitchedProbe1.durationSeconds).toBeLessThanOrEqual(2.9);

    const [r1Early, g1Early, b1Early] = await probeVideoFrameRgb(outRedFirst, 0.5);
    const [r1Late, g1Late, b1Late] = await probeVideoFrameRgb(outRedFirst, 1.9);
    // Early frame (0.5s) is predominantly RED; late frame (1.9s) is predominantly BLUE
    expect(r1Early).toBeGreaterThan(b1Early + 80);
    expect(r1Early).toBeGreaterThan(g1Early + 80);
    expect(b1Late).toBeGreaterThan(r1Late + 80);
    expect(b1Late).toBeGreaterThan(g1Late + 80);

    // Order B: Blue (#1) -> Red (#2)
    const outBlueFirst = path.join(dir, "out_blue_first.mp4");
    const stitchedProbe2 = await concatenateValidatedClips(
      [probeBlue, probeRed],
      outBlueFirst,
      DEFAULT_RENDER_WORKER_LIMITS,
      { workDir: dir }
    );
    expect(stitchedProbe2.durationSeconds).toBeGreaterThanOrEqual(2.3);

    const [r2Early, , b2Early] = await probeVideoFrameRgb(outBlueFirst, 0.5);
    const [r2Late, , b2Late] = await probeVideoFrameRgb(outBlueFirst, 1.9);
    // Early frame (0.5s) is now predominantly BLUE; late frame (1.9s) is now predominantly RED
    expect(b2Early).toBeGreaterThan(r2Early + 80);
    expect(r2Late).toBeGreaterThan(b2Late + 80);
  }, 45_000);

  it("rejects missing, empty, or corrupt non-video files during ffprobe inspection", async () => {
    const dir = await makeWorkDir();
    const missingPath = path.join(dir, "nonexistent.mp4");
    await expect(probeMediaFile(missingPath)).rejects.toThrow();

    const emptyPath = path.join(dir, "empty.mp4");
    await fs.writeFile(emptyPath, Buffer.alloc(0));
    await expect(probeMediaFile(emptyPath)).rejects.toThrow(/empty/i);

    const corruptPath = path.join(dir, "corrupt.mp4");
    await fs.writeFile(corruptPath, Buffer.from("not-a-valid-video-container-payload", "utf8"));
    await expect(probeMediaFile(corruptPath)).rejects.toThrow();
  });

  it("enforces explicit codec, dimension, duration, and file-size bounds", () => {
    const baseProbe = {
      filePath: "/tmp/clip.mp4",
      sizeBytes: 1024 * 100,
      formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      durationSeconds: 5.0,
      videoCodec: "h264",
      width: 640,
      height: 360,
      pixelFormat: "yuv420p",
      hasAudio: true,
      audioCodec: "aac",
    };

    expect(validateProbedClip(baseProbe).valid).toBe(true);

    expect(
      validateProbedClip({ ...baseProbe, videoCodec: "prores" }).valid
    ).toBe(false);

    expect(
      validateProbedClip({ ...baseProbe, width: 32, height: 32 }).valid
    ).toBe(false);

    expect(
      validateProbedClip({ ...baseProbe, durationSeconds: 0.05 }).valid
    ).toBe(false);

    expect(
      validateProbedClip({
        ...baseProbe,
        sizeBytes: DEFAULT_RENDER_WORKER_LIMITS.maxClipSizeBytes + 1,
      }).valid
    ).toBe(false);
  });

  it("enforces worker deadline timeouts and sanitizes failure reasons safely", async () => {
    const dir = await makeWorkDir();
    const clipPath = path.join(dir, "clip.mp4");
    await generateSyntheticVideoClip(clipPath, {
      color: "green",
      width: 320,
      height: 240,
      durationSeconds: 1.0,
    });
    const probe = await probeMediaFile(clipPath);

    const outPath = path.join(dir, "out.mp4");
    await expect(
      concatenateValidatedClips([probe], outPath, DEFAULT_RENDER_WORKER_LIMITS, {
        workDir: dir,
        deadlineMs: Date.now() - 10, // Already expired deadline
      })
    ).rejects.toThrow(/timeout/i);

    const sanitized = sanitizeWorkerFailureReason(
      new Error("Media processor error: C:\\secret\\path\\corrupt.mp4 failed")
    );
    expect(sanitized).not.toContain("C:\\secret\\path");
    expect(sanitized).toMatch(/corrupt|unreadable/i);
  }, 30_000);

  it("cleans up orphaned temporary render directories and selects stitching provider by env", async () => {
    const baseTmp = await makeWorkDir();
    const orphanDir = path.join(baseTmp, `${TEMP_DIR_PREFIX}orphan-test`);
    await fs.mkdir(orphanDir, { recursive: true });
    await fs.writeFile(path.join(orphanDir, "partial.mp4"), "temp");

    const cleaned = await cleanupOrphanedRenderTempDirs(0, baseTmp);
    expect(cleaned).toBe(1);

    const contractProvider = createStitchingProvider({});
    expect(contractProvider).toBeInstanceOf(ContractQueueStitchingAdapter);
    expect(contractProvider.isExternalWorkerConfigured).toBe(false);

    const workerProvider = createStitchingProvider({
      RENDER_WORKER_ENABLED: "true",
    });
    expect(workerProvider).toBeInstanceOf(FfmpegWorkerQueueAdapter);
    expect(workerProvider.isExternalWorkerConfigured).toBe(true);
  });
});
