import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupOrphanedRenderTempDirs,
  processProjectRenderJob,
  resolveFfmpegBinaries,
  resolveWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "../src/lib/collaboration/ffmpeg-worker";
import type { Database } from "../src/lib/supabase/types";

export function loadWorkerDotEnvLocal(
  targetEnv: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): void {
  const envPath = path.resolve(cwd, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (targetEnv[key] === undefined) {
          targetEnv[key] = val;
        }
      }
    }
  }
}

export async function runRenderWorkerMain(
  rawEnv: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv.slice(2)
): Promise<void> {
  const config: WorkerRuntimeConfig = resolveWorkerRuntimeConfig(rawEnv, argv);

  const binaries = resolveFfmpegBinaries(rawEnv);
  console.log("=== HIHA Video Rendering Worker ===");
  console.log(`FFmpeg binary:  ${binaries.ffmpegPath}`);
  console.log(`ffprobe binary: ${binaries.ffprobePath}`);

  const cleaned = await cleanupOrphanedRenderTempDirs();
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} orphaned temporary render directories.`);
  }

  const client = createClient<Database>(
    config.supabaseUrl,
    config.supabaseKey,
    {
      auth: { persistSession: false },
    }
  );

  const { data: authData, error: authErr } =
    await client.auth.signInWithPassword({
      email: config.workerEmail,
      password: config.workerPassword,
    });

  if (authErr || !authData.user) {
    throw new Error(
      "Worker authentication failed: invalid credentials or no active session."
    );
  }

  const actorUserId = authData.user.id;
  console.log(`Authenticated least-privilege worker session: ${actorUserId}`);

  let stopRequested = false;
  const onStop = () => {
    stopRequested = true;
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  try {
    do {
      const result = await processProjectRenderJob(client, actorUserId, {
        jobId: config.jobId,
      });

      if (result.claimed) {
        if (result.status === "completed") {
          console.log(
            `[COMPLETED] Job ${result.jobId} (Project ${result.projectId}) -> ${result.outputMediaPath} (${result.outputProbe?.durationSeconds.toFixed(2)}s, ${result.outputProbe?.width}x${result.outputProbe?.height})`
          );
        } else {
          console.log(
            `[FAILED] Job ${result.jobId} (Project ${result.projectId}): ${result.failureReason}`
          );
        }
      } else if (!config.isPoll) {
        console.log(
          config.jobId
            ? `Job ${config.jobId} was not in a claimable queued state (${result.failureReason || "already processed or not queued"}).`
            : "No queued render jobs available to claim."
        );
      }

      if (config.isPoll && !stopRequested) {
        await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
      }
    } while (config.isPoll && !stopRequested);
  } finally {
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
    await client.auth.signOut();
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (
  invokedFilePath &&
  path.normalize(currentFilePath).toLowerCase() ===
    path.normalize(invokedFilePath).toLowerCase()
) {
  loadWorkerDotEnvLocal(process.env, process.cwd());
  runRenderWorkerMain(process.env, process.argv.slice(2)).catch((err: unknown) => {
    const message =
      err instanceof Error
        ? err.message
        : "Invalid or missing render worker configuration.";
    console.error(`Worker configuration error: ${message}`);
    process.exit(1);
  });
}
