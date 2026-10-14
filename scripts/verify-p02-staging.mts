import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "../src/lib/supabase/types";
import {
  buildCanonicalRenderOutputPath,
  generateSyntheticVideoClip,
  probeMediaFile,
  probeVideoFrameRgb,
  processProjectRenderJob,
  resolveFfmpegBinaries,
} from "../src/lib/collaboration/ffmpeg-worker";

// Load staging environment file from --env-file CLI arg, STAGING_ENV_PATH, or default .env.local
const envFlagIdx = process.argv.indexOf("--env-file");
const cliEnvPath =
  envFlagIdx !== -1 && envFlagIdx + 1 < process.argv.length
    ? process.argv[envFlagIdx + 1]
    : undefined;

const envFilePath = cliEnvPath
  ? path.resolve(cliEnvPath)
  : process.env.STAGING_ENV_PATH
    ? path.resolve(process.env.STAGING_ENV_PATH)
    : path.resolve(process.cwd(), ".env.local");

if (fs.existsSync(envFilePath)) {
  const content = fs.readFileSync(envFilePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

// Guardrail: Ensure we NEVER run staging destructive/fixture tests against production if STAGING_PROJECT_REF is set
if (
  process.env.STAGING_PROJECT_REF &&
  !supabaseUrl.includes(process.env.STAGING_PROJECT_REF)
) {
  console.error(
    `Refusing to run: target URL (${supabaseUrl}) does not match expected staging ref (${process.env.STAGING_PROJECT_REF}).`
  );
  process.exit(1);
}

interface TestResult {
  scenario: string;
  name: string;
  status: "PASS" | "FAIL";
  details: string;
}

const results: TestResult[] = [];

function record(
  scenario: string,
  name: string,
  status: "PASS" | "FAIL",
  details: string
) {
  results.push({ scenario, name, status, details });
  console.log(`[${status}] (${scenario}) ${name}: ${details}`);
}

function makeClient(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInUser(
  email: string,
  password = "ValidPassword123!"
): Promise<{ client: SupabaseClient<Database>; userId: string }> {
  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user || !data.session) {
    throw new Error(`Failed to sign in ${email}: ${error?.message || "No session"}`);
  }
  return { client, userId: data.user.id };
}

const DEFAULT_VIDEO_META = {
  mimeType: "video/mp4",
  sizeBytes: 4096,
  durationSeconds: 1.0,
};

async function runStagingVerification() {
  console.log("=== HIHA MILESTONE 4.5 P0-2: STAGING DATABASE VERIFICATION SUITE ===");
  console.log("Staging Target URL:", supabaseUrl);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiha-p02-staging-verify-"));
  const anonClient = makeClient();

  const cleanupProjects: Array<{ client: SupabaseClient<Database>; id: string }> = [];
  const cleanupPosts: Array<{ client: SupabaseClient<Database>; id: string }> = [];
  const cleanupStorage: Array<{ client: SupabaseClient<Database>; path: string }> = [];

  try {
    // Sign in disposable users & dedicated workers
    const [
      { client: clientA, userId: userAId },
      { client: clientB, userId: userBId },
      { client: clientC, userId: userCId },
      { client: clientD, userId: userDId },
      { client: clientE, userId: userEId },
      { client: clientF, userId: userFId },
      { client: worker1Client, userId: worker1Id },
      { client: worker2Client, userId: worker2Id },
    ] = await Promise.all([
      signInUser("test_user_a@hiha.internal"),
      signInUser("test_user_b@hiha.internal"),
      signInUser("test_user_c@hiha.internal"),
      signInUser("test_user_d@hiha.internal"),
      signInUser("test_user_e@hiha.internal"),
      signInUser("test_user_f@hiha.internal"),
      signInUser("render_worker_p02@hiha.internal"),
      signInUser("render_worker_p02b@hiha.internal"),
    ]);

    // Synthesize reusable real MP4 video clips using FFmpeg
    const redClipLocal = path.join(tempDir, "clip_red_silent.mp4");
    const blueClipLocal = path.join(tempDir, "clip_blue_audio.mp4");
    const greenClipLocal = path.join(tempDir, "clip_green_audio.mp4");

    const [redBytes, blueBytes, greenBytes] = await Promise.all([
      generateSyntheticVideoClip(redClipLocal, {
        color: "red",
        width: 320,
        height: 180,
        durationSeconds: 1.0,
        fps: 24,
        withAudio: false,
      }),
      generateSyntheticVideoClip(blueClipLocal, {
        color: "blue",
        width: 640,
        height: 360,
        durationSeconds: 1.0,
        fps: 24,
        withAudio: true,
        audioFreqHz: 440,
      }),
      generateSyntheticVideoClip(greenClipLocal, {
        color: "lime",
        width: 320,
        height: 180,
        durationSeconds: 1.0,
        fps: 24,
        withAudio: true,
        audioFreqHz: 660,
      }),
    ]);

    // Upload base clips for User A, User B, User C, User D, User F
    const clipAPath = `${userAId}/p02-clip-a-blue-${Date.now()}.mp4`;
    const clipBPath = `${userBId}/p02-clip-b-red-${Date.now()}.mp4`;
    const clipCPath = `${userCId}/p02-clip-c-red-${Date.now()}.mp4`;
    const clipDPath = `${userDId}/p02-clip-d-green-${Date.now()}.mp4`;
    const clipFPath = `${userFId}/p02-clip-f-red-${Date.now()}.mp4`;

    await Promise.all([
      clientA.storage.from("media").upload(clipAPath, blueBytes, { contentType: "video/mp4", upsert: true }),
      clientB.storage.from("media").upload(clipBPath, redBytes, { contentType: "video/mp4", upsert: true }),
      clientC.storage.from("media").upload(clipCPath, redBytes, { contentType: "video/mp4", upsert: true }),
      clientD.storage.from("media").upload(clipDPath, greenBytes, { contentType: "video/mp4", upsert: true }),
      clientF.storage.from("media").upload(clipFPath, redBytes, { contentType: "video/mp4", upsert: true }),
    ]);

    cleanupStorage.push(
      { client: clientA, path: clipAPath },
      { client: clientB, path: clipBPath },
      { client: clientC, path: clipCPath },
      { client: clientD, path: clipDPath },
      { client: clientF, path: clipFPath }
    );

    // =========================================================================
    // SCENARIO 1: Multi-User Non-Participant Worker Render (User A Project, User B Project, Private Project)
    // =========================================================================
    console.log("\n--- Scenario 1: Multi-User Non-Participant Worker Render ---");
    let projAId = "";
    let projBId = "";
    let privProjAId = "";
    let clipCInProjAId = "";

    try {
      // 1A. User A creates public Project A; User C joins and contributes RED (seq 1), User A contributes BLUE (seq 2)
      const { data: pA, error: pAErr } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 Staging Project A ${Date.now()}`,
          visibility: "public",
          participation_mode: "open",
        })
        .select("id")
        .single();
      if (pAErr || !pA) throw new Error(`Project A creation failed: ${pAErr?.message}`);
      projAId = pA.id;
      cleanupProjects.push({ client: clientA, id: projAId });

      await clientC.from("project_participants").insert({
        project_id: projAId,
        user_id: userCId,
        role: "contributor",
        status: "active",
      });

      const [cC, cA] = await Promise.all([
        clientC
          .from("project_contributions")
          .insert({
            project_id: projAId,
            contributor_id: userCId,
            media_path: clipCPath,
            media_type: "short_video",
            media_metadata: { mimeType: "video/mp4", sizeBytes: redBytes.byteLength, durationSeconds: 1.0 },
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
            ai_disclosure_status: "no_ai_declared",
          })
          .select("id")
          .single(),
        clientA
          .from("project_contributions")
          .insert({
            project_id: projAId,
            contributor_id: userAId,
            media_path: clipAPath,
            media_type: "short_video",
            media_metadata: { mimeType: "video/mp4", sizeBytes: blueBytes.byteLength, durationSeconds: 1.0 },
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
            ai_disclosure_status: "ai_assisted",
            ai_disclosure_details: "Staging P0-2 test disclosure",
          })
          .select("id")
          .single(),
      ]);

      clipCInProjAId = cC.data?.id || "";

      await Promise.all([
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
          .eq("id", clipCInProjAId),
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 2, reviewed_by: userAId })
          .eq("id", cA.data?.id || ""),
      ]);

      const { data: jobA, error: jobAErr } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: projAId,
          requested_by: userAId,
          idempotency_key: `p02-stage-job-a-${Date.now()}`,
        })
        .select("id")
        .single();
      if (jobAErr || !jobA) throw new Error(`Job A queue failed: ${jobAErr?.message}`);

      // 1B. User B creates public Project B; User D joins and contributes GREEN (seq 1), User B contributes RED (seq 2)
      const { data: pB, error: pBErr } = await clientB
        .from("collaborative_projects")
        .insert({
          creator_id: userBId,
          title: `P0-2 Staging Project B ${Date.now()}`,
          visibility: "public",
          participation_mode: "open",
        })
        .select("id")
        .single();
      if (pBErr || !pB) throw new Error(`Project B creation failed: ${pBErr?.message}`);
      projBId = pB.id;
      cleanupProjects.push({ client: clientB, id: projBId });

      await clientD.from("project_participants").insert({
        project_id: projBId,
        user_id: userDId,
        role: "contributor",
        status: "active",
      });

      const [cD, cB] = await Promise.all([
        clientD
          .from("project_contributions")
          .insert({
            project_id: projBId,
            contributor_id: userDId,
            media_path: clipDPath,
            media_type: "short_video",
            media_metadata: { mimeType: "video/mp4", sizeBytes: greenBytes.byteLength, durationSeconds: 1.0 },
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientB
          .from("project_contributions")
          .insert({
            project_id: projBId,
            contributor_id: userBId,
            media_path: clipBPath,
            media_type: "short_video",
            media_metadata: { mimeType: "video/mp4", sizeBytes: redBytes.byteLength, durationSeconds: 1.0 },
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
      ]);

      await Promise.all([
        clientB
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 1, reviewed_by: userBId })
          .eq("id", cD.data?.id || ""),
        clientB
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 2, reviewed_by: userBId })
          .eq("id", cB.data?.id || ""),
      ]);

      const { data: jobB, error: jobBErr } = await clientB
        .from("project_render_jobs")
        .insert({
          project_id: projBId,
          requested_by: userBId,
          idempotency_key: `p02-stage-job-b-${Date.now()}`,
        })
        .select("id")
        .single();
      if (jobBErr || !jobB) throw new Error(`Job B queue failed: ${jobBErr?.message}`);

      // 1C. User A creates a PRIVATE invite-only project with User C
      const { data: privP, error: privPErr } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 Staging Private Project ${Date.now()}`,
          visibility: "private",
          participation_mode: "invite_only",
        })
        .select("id")
        .single();
      if (privPErr || !privP) throw new Error(`Private Project creation failed: ${privPErr?.message}`);
      privProjAId = privP.id;
      cleanupProjects.push({ client: clientA, id: privProjAId });

      await clientA.from("project_participants").insert({
        project_id: privProjAId,
        user_id: userCId,
        role: "contributor",
        status: "invited",
        invited_by: userAId,
      });
      await clientC
        .from("project_participants")
        .update({ status: "active" })
        .eq("project_id", privProjAId)
        .eq("user_id", userCId);

      const [privCC, privCA] = await Promise.all([
        clientC
          .from("project_contributions")
          .insert({
            project_id: privProjAId,
            contributor_id: userCId,
            media_path: clipCPath,
            media_type: "short_video",
            media_metadata: { mimeType: "video/mp4", sizeBytes: redBytes.byteLength, durationSeconds: 1.0 },
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientA
          .from("project_contributions")
          .insert({
            project_id: privProjAId,
            contributor_id: userAId,
            media_path: clipAPath,
            media_type: "short_video",
            media_metadata: { mimeType: "video/mp4", sizeBytes: blueBytes.byteLength, durationSeconds: 1.0 },
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
      ]);

      await Promise.all([
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
          .eq("id", privCC.data?.id || ""),
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 2, reviewed_by: userAId })
          .eq("id", privCA.data?.id || ""),
      ]);

      const { data: jobPriv, error: jobPrivErr } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: privProjAId,
          requested_by: userAId,
          idempotency_key: `p02-stage-job-priv-${Date.now()}`,
        })
        .select("id")
        .single();
      if (jobPrivErr || !jobPriv) throw new Error(`Job Priv queue failed: ${jobPrivErr?.message}`);

      // Dedicated non-participant Worker 1 processes Job A, Job B, and Job Priv
      const resA = await processProjectRenderJob(worker1Client, worker1Id, { jobId: jobA.id });
      const resB = await processProjectRenderJob(worker1Client, worker1Id, { jobId: jobB.id });
      const resPriv = await processProjectRenderJob(worker1Client, worker1Id, { jobId: jobPriv.id });

      if (resA.outputMediaPath) cleanupStorage.push({ client: clientA, path: resA.outputMediaPath });
      if (resB.outputMediaPath) cleanupStorage.push({ client: clientB, path: resB.outputMediaPath });
      if (resPriv.outputMediaPath) cleanupStorage.push({ client: clientA, path: resPriv.outputMediaPath });

      // Verify outputs via ffprobe and RGB frame sampling
      const binaries = resolveFfmpegBinaries();
      const [signA, signB, signPrivC] = await Promise.all([
        clientA.storage.from("media").createSignedUrl(resA.outputMediaPath || "", 60),
        clientB.storage.from("media").createSignedUrl(resB.outputMediaPath || "", 60),
        clientC.storage.from("media").createSignedUrl(resPriv.outputMediaPath || "", 60),
      ]);

      const outALocal = path.join(tempDir, "out_a.mp4");
      const outBLocal = path.join(tempDir, "out_b.mp4");
      fs.writeFileSync(outALocal, Buffer.from(await (await fetch(signA.data!.signedUrl)).arrayBuffer()));
      fs.writeFileSync(outBLocal, Buffer.from(await (await fetch(signB.data!.signedUrl)).arrayBuffer()));

      const [probeA, probeB] = await Promise.all([
        probeMediaFile(outALocal, binaries),
        probeMediaFile(outBLocal, binaries),
      ]);
      const [rgbA1, rgbA2, rgbB1, rgbB2] = await Promise.all([
        probeVideoFrameRgb(outALocal, 0.4, binaries),
        probeVideoFrameRgb(outALocal, 1.5, binaries),
        probeVideoFrameRgb(outBLocal, 0.4, binaries),
        probeVideoFrameRgb(outBLocal, 1.5, binaries),
      ]);

      // Job A: Seq 1 = RED, Seq 2 = BLUE
      const seqAOk = rgbA1[0] > 180 && rgbA1[1] < 70 && rgbA2[2] > 180 && rgbA2[0] < 70;
      // Job B: Seq 1 = LIME/GREEN, Seq 2 = RED
      const seqBOk = rgbB1[1] > 150 && rgbB1[0] < 80 && rgbB2[0] > 180 && rgbB2[1] < 70;

      if (
        resA.status === "completed" &&
        resB.status === "completed" &&
        resPriv.status === "completed" &&
        probeA.videoCodec === "h264" &&
        probeB.videoCodec === "h264" &&
        seqAOk &&
        seqBOk &&
        Boolean(signPrivC.data?.signedUrl)
      ) {
        record(
          "Scenario 1",
          "Multi-User & Private-Project Non-Participant Worker Render",
          "PASS",
          `Worker (${worker1Id.slice(0, 8)}) rendered User A public project (${probeA.durationSeconds.toFixed(2)}s RED->BLUE), User B public project (${probeB.durationSeconds.toFixed(2)}s GREEN->RED), and User A private project without editor/participant membership`
        );
      } else {
        record(
          "Scenario 1",
          "Multi-User & Private-Project Non-Participant Worker Render",
          "FAIL",
          `resA=${resA.status}(${resA.failureReason}), resB=${resB.status}(${resB.failureReason}), resPriv=${resPriv.status}(${resPriv.failureReason}), seqAOk=${seqAOk}, seqBOk=${seqBOk} (rgbB1=${rgbB1.join(",")}, rgbB2=${rgbB2.join(",")})`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 1",
        "Multi-User & Private-Project Non-Participant Worker Render",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 2: Manifest-Only Clip Access & RESTRICTIVE Worker Isolation
    // =========================================================================
    console.log("\n--- Scenario 2: Manifest-Only Clip Access & Worker Isolation ---");
    try {
      // Create a public post by User A with media to verify dedicated worker is blocked from reading posts & post media
      const postMediaPath = `${userAId}/p02-worker-post-check-${Date.now()}.mp4`;
      await clientA.storage.from("media").upload(postMediaPath, blueBytes, { contentType: "video/mp4", upsert: true });
      cleanupStorage.push({ client: clientA, path: postMediaPath });

      const { data: pubPost } = await clientA
        .from("posts")
        .insert({
          creator_id: userAId,
          content_type: "short_video",
          caption: "Public post that dedicated worker must not read",
          media_path: postMediaPath,
          status: "published",
          visibility: "public",
          published_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (pubPost) cleanupPosts.push({ client: clientA, id: pubPost.id });

      // Upload separate clips for pending, rejected, withdrawn, and unrelated project
      const pendingClipPath = `${userCId}/p02-pending-clip-${Date.now()}.mp4`;
      const rejectedClipPath = `${userCId}/p02-rejected-clip-${Date.now()}.mp4`;
      const withdrawnClipPath = `${userCId}/p02-withdrawn-clip-${Date.now()}.mp4`;
      const activeManifestClipPath = `${userCId}/p02-manifest-clip-${Date.now()}.mp4`;
      const unrelatedClipPath = `${userDId}/p02-unrelated-clip-${Date.now()}.mp4`;

      await Promise.all([
        clientC.storage.from("media").upload(pendingClipPath, redBytes, { contentType: "video/mp4", upsert: true }),
        clientC.storage.from("media").upload(rejectedClipPath, redBytes, { contentType: "video/mp4", upsert: true }),
        clientC.storage.from("media").upload(withdrawnClipPath, redBytes, { contentType: "video/mp4", upsert: true }),
        clientC.storage.from("media").upload(activeManifestClipPath, redBytes, { contentType: "video/mp4", upsert: true }),
        clientD.storage.from("media").upload(unrelatedClipPath, greenBytes, { contentType: "video/mp4", upsert: true }),
      ]);
      cleanupStorage.push(
        { client: clientC, path: pendingClipPath },
        { client: clientC, path: rejectedClipPath },
        { client: clientC, path: withdrawnClipPath },
        { client: clientC, path: activeManifestClipPath },
        { client: clientD, path: unrelatedClipPath }
      );

      // Unrelated private project owned by User B with User D's approved clip (no active job claimed by Worker 1)
      const { data: unrelProj } = await clientB
        .from("collaborative_projects")
        .insert({
          creator_id: userBId,
          title: `P0-2 Unrelated Project ${Date.now()}`,
          visibility: "private",
          participation_mode: "invite_only",
        })
        .select("id")
        .single();
      if (unrelProj) cleanupProjects.push({ client: clientB, id: unrelProj.id });

      await clientB.from("project_participants").insert({
        project_id: unrelProj!.id,
        user_id: userDId,
        role: "contributor",
        status: "invited",
        invited_by: userBId,
      });
      await clientD
        .from("project_participants")
        .update({ status: "active" })
        .eq("project_id", unrelProj!.id)
        .eq("user_id", userDId);

      const { data: unrelContrib, error: unrelErr } = await clientD
        .from("project_contributions")
        .insert({
          project_id: unrelProj!.id,
          contributor_id: userDId,
          media_path: unrelatedClipPath,
          media_type: "short_video",
          media_metadata: DEFAULT_VIDEO_META,
          consent_granted: true,
          consent_policy_version: "v1.0-collaborative-2026",
        })
        .select("id")
        .single();
      if (unrelErr || !unrelContrib) throw new Error(`unrelContrib insert failed: ${unrelErr?.message}`);

      await clientB
        .from("project_contributions")
        .update({ review_status: "approved", sequence_order: 1, reviewed_by: userBId })
        .eq("id", unrelContrib.id);

      // Target project owned by User A with 4 clips: 1 approved (in manifest), 1 pending, 1 rejected, 1 withdrawn
      const { data: scopeProj } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 Manifest Scope Project ${Date.now()}`,
          visibility: "private",
          participation_mode: "invite_only",
        })
        .select("id")
        .single();
      if (scopeProj) cleanupProjects.push({ client: clientA, id: scopeProj.id });

      await clientA.from("project_participants").insert({
        project_id: scopeProj!.id,
        user_id: userCId,
        role: "contributor",
        status: "invited",
        invited_by: userAId,
      });
      await clientC
        .from("project_participants")
        .update({ status: "active" })
        .eq("project_id", scopeProj!.id)
        .eq("user_id", userCId);

      const [cManifest, cPending, cRejected, cWithdrawn] = await Promise.all([
        clientC
          .from("project_contributions")
          .insert({
            project_id: scopeProj!.id,
            contributor_id: userCId,
            media_path: activeManifestClipPath,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientC
          .from("project_contributions")
          .insert({
            project_id: scopeProj!.id,
            contributor_id: userCId,
            media_path: pendingClipPath,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientC
          .from("project_contributions")
          .insert({
            project_id: scopeProj!.id,
            contributor_id: userCId,
            media_path: rejectedClipPath,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientC
          .from("project_contributions")
          .insert({
            project_id: scopeProj!.id,
            contributor_id: userCId,
            media_path: withdrawnClipPath,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
      ]);

      await Promise.all([
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
          .eq("id", cManifest.data!.id),
        clientA
          .from("project_contributions")
          .update({ review_status: "rejected", reviewed_by: userAId })
          .eq("id", cRejected.data!.id),
        clientC
          .from("project_contributions")
          .update({
            consent_granted: false,
            review_status: "withdrawn",
            withdrawal_reason: "Withdrawn before render",
          })
          .eq("id", cWithdrawn.data!.id),
      ]);

      const { data: scopeJob } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: scopeProj!.id,
          requested_by: userAId,
          idempotency_key: `p02-scope-job-${Date.now()}`,
        })
        .select("id")
        .single();

      let duringProcessingChecksPassed = false;
      let duringProcessingDiag = "";

      const scopeRes = await processProjectRenderJob(worker1Client, worker1Id, {
        jobId: scopeJob!.id,
        onAfterClaim: async () => {
          // While job is actively 'processing' and claimed by Worker 1:
          const [
            workerPosts,
            workerPostMediaSign,
            workerVisibleContribs,
            signManifest,
            signPending,
            signRejected,
            signWithdrawn,
            signUnrelated,
          ] = await Promise.all([
            worker1Client.from("posts").select("id"),
            worker1Client.storage.from("media").createSignedUrl(postMediaPath, 60),
            worker1Client
              .from("project_contributions")
              .select("id")
              .in("project_id", [scopeProj!.id, unrelProj!.id]),
            worker1Client.storage.from("media").createSignedUrl(activeManifestClipPath, 60),
            worker1Client.storage.from("media").createSignedUrl(pendingClipPath, 60),
            worker1Client.storage.from("media").createSignedUrl(rejectedClipPath, 60),
            worker1Client.storage.from("media").createSignedUrl(withdrawnClipPath, 60),
            worker1Client.storage.from("media").createSignedUrl(unrelatedClipPath, 60),
          ]);

          const visibleIds = (workerVisibleContribs.data ?? []).map((r) => r.id);
          duringProcessingChecksPassed =
            (workerPosts.data?.length ?? 0) === 0 &&
            Boolean(workerPostMediaSign.error) &&
            visibleIds.length === 1 &&
            visibleIds[0] === cManifest.data!.id &&
            !signManifest.error &&
            Boolean(signManifest.data?.signedUrl) &&
            Boolean(signPending.error) &&
            Boolean(signRejected.error) &&
            Boolean(signWithdrawn.error) &&
            Boolean(signUnrelated.error);

          duringProcessingDiag = `posts=${workerPosts.data?.length}, postMediaErr=${!!workerPostMediaSign.error}, visibleContribs=${visibleIds.length}, manifestUrl=${!!signManifest.data?.signedUrl}, pendingErr=${!!signPending.error}, rejectedErr=${!!signRejected.error}, withdrawnErr=${!!signWithdrawn.error}, unrelatedErr=${!!signUnrelated.error}`;
        },
      });

      if (scopeRes.outputMediaPath) {
        cleanupStorage.push({ client: clientA, path: scopeRes.outputMediaPath });
      }

      // After job completes, verify Worker 1 can NO LONGER read the source clip or private project
      const [postJobClipSign, postJobContribRows, postJobPrivProj] = await Promise.all([
        worker1Client.storage.from("media").createSignedUrl(activeManifestClipPath, 60),
        worker1Client.from("project_contributions").select("id").eq("id", cManifest.data!.id),
        worker1Client.from("collaborative_projects").select("id").eq("id", scopeProj!.id),
      ]);

      const postCompletionRevoked =
        Boolean(postJobClipSign.error) &&
        (postJobContribRows.data?.length ?? 0) === 0 &&
        (postJobPrivProj.data?.length ?? 0) === 0;

      if (
        scopeRes.status === "completed" &&
        duringProcessingChecksPassed &&
        postCompletionRevoked
      ) {
        record(
          "Scenario 2",
          "Manifest-Only Clip Access, Post Denial & Post-Job Revocation",
          "PASS",
          `Worker read ONLY active manifest clip during 'processing' (${duringProcessingDiag}) and lost access immediately upon completion`
        );
      } else {
        record(
          "Scenario 2",
          "Manifest-Only Clip Access, Post Denial & Post-Job Revocation",
          "FAIL",
          `status=${scopeRes.status}, during=${duringProcessingChecksPassed} (${duringProcessingDiag}), revokedAfter=${postCompletionRevoked}`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 2",
        "Manifest-Only Clip Access, Post Denial & Post-Job Revocation",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 3: Helper RPC Enumeration & Cross-User Probing Protection
    // =========================================================================
    console.log("\n--- Scenario 3: Helper RPC Enumeration & Cross-User Probing Protection ---");
    try {
      const sampleCanonicalPath = buildCanonicalRenderOutputPath(
        userAId,
        projAId,
        randomUUID()
      );

      // User E (ordinary non-participant user) attempts to probe Worker 1, User A, and User C
      const [
        probeAuthWorker,
        probeDedWorker,
        probeProjEditor,
        probeActivePart,
        probeCanViewPriv,
        probeWorkerProc,
        probeContribManifest,
        probeMediaManifest,
        probeCanUpload,
        probeCanCleanup,
      ] = await Promise.all([
        clientE.rpc("is_authorized_render_worker", { u_id: worker1Id }),
        clientE.rpc("is_dedicated_render_worker_only", { u_id: worker1Id }),
        clientE.rpc("is_project_editor", { p_id: projAId, u_id: userAId }),
        clientE.rpc("is_project_active_participant", { p_id: projAId, u_id: userCId }),
        clientE.rpc("can_view_project", { p_id: privProjAId, u_id: userAId }),
        clientE.rpc("is_worker_processing_project", {
          p_project_id: projAId,
          p_worker_id: worker1Id,
        }),
        clientE.rpc("is_contribution_in_active_worker_manifest", {
          p_project_id: projAId,
          p_contribution_id: clipCInProjAId,
          p_worker_id: worker1Id,
        }),
        clientE.rpc("is_media_in_active_worker_manifest", {
          p_media_path: clipCPath,
          p_worker_id: worker1Id,
        }),
        clientE.rpc("can_upload_render_output_object", {
          p_object_name: sampleCanonicalPath,
          p_worker_id: worker1Id,
        }),
        clientE.rpc("can_cleanup_render_output_object", {
          p_object_name: sampleCanonicalPath,
          p_worker_id: worker1Id,
        }),
      ]);

      const allCrossUserProbesReturnedFalse =
        probeAuthWorker.data === false &&
        probeDedWorker.data === false &&
        probeProjEditor.data === false &&
        probeActivePart.data === false &&
        probeCanViewPriv.data === false &&
        probeWorkerProc.data === false &&
        probeContribManifest.data === false &&
        probeMediaManifest.data === false &&
        probeCanUpload.data === false &&
        probeCanCleanup.data === false;

      // Internal helper RPCs must reject direct client invocation with permission denied
      const internalClient = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      });
      await internalClient.auth.signInWithPassword({
        email: "test_user_e@hiha.internal",
        password: "ValidPassword123!",
      });

      const [intPartCall, intManifestCall, intCanonicalCall] = await Promise.all([
        internalClient.rpc("is_active_project_participant_internal", {
          p_id: projAId,
          u_id: userCId,
        }),
        internalClient.rpc("validate_render_job_manifest_integrity", {
          p_project_id: projAId,
          p_manifest: [],
        }),
        internalClient.rpc("is_canonical_render_output_path", {
          p_object_name: sampleCanonicalPath,
          p_project_creator_id: userAId,
          p_project_id: projAId,
          p_job_id: randomUUID(),
        }),
      ]);

      const internalCallsDenied =
        Boolean(intPartCall.error) &&
        Boolean(intManifestCall.error) &&
        Boolean(intCanonicalCall.error);

      // Project Editor User A CAN check User C's participation in Project A, but CANNOT check User D in Project B
      const [editorCheckOwnProj, editorCheckOtherProj] = await Promise.all([
        clientA.rpc("is_project_active_participant", { p_id: projAId, u_id: userCId }),
        clientA.rpc("is_project_active_participant", { p_id: projBId, u_id: userDId }),
      ]);

      if (
        allCrossUserProbesReturnedFalse &&
        internalCallsDenied &&
        editorCheckOwnProj.data === true &&
        editorCheckOtherProj.data === false
      ) {
        record(
          "Scenario 3",
          "Helper RPC Anti-Enumeration & Internal Helper REVOKE Enforcement",
          "PASS",
          "All 10 cross-user helper probes returned false; all 3 internal helpers rejected direct RPC calls with permission denied; editor check scoped strictly to own project"
        );
      } else {
        record(
          "Scenario 3",
          "Helper RPC Anti-Enumeration & Internal Helper REVOKE Enforcement",
          "FAIL",
          `allFalse=${allCrossUserProbesReturnedFalse}, internalDenied=${internalCallsDenied} (${intPartCall.error?.message}), editorOwn=${editorCheckOwnProj.data}, editorOther=${editorCheckOtherProj.data}`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 3",
        "Helper RPC Anti-Enumeration & Internal Helper REVOKE Enforcement",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 4: Unauthenticated (anon) Project Reads & RPC Restrictions
    // =========================================================================
    console.log("\n--- Scenario 4: Unauthenticated (anon) Project Reads & RPC Restrictions ---");
    try {
      // Create a draft project owned by User A to verify anon cannot see draft projects
      const { data: draftProj } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 Draft Project ${Date.now()}`,
          visibility: "public",
          participation_mode: "open",
          status: "draft",
        })
        .select("id")
        .single();
      if (draftProj) cleanupProjects.push({ client: clientA, id: draftProj.id });

      const [
        anonPubProj,
        anonPrivProj,
        anonDraftProj,
        anonCanViewPub,
        anonCanViewPriv,
        anonClaimRpc,
        anonWorkerCheckRpc,
      ] = await Promise.all([
        anonClient.from("collaborative_projects").select("id, visibility, status").eq("id", projAId).maybeSingle(),
        anonClient.from("collaborative_projects").select("id").eq("id", privProjAId).maybeSingle(),
        anonClient.from("collaborative_projects").select("id").eq("id", draftProj!.id).maybeSingle(),
        anonClient.rpc("can_view_project", { p_id: projAId, u_id: null as unknown as string }),
        anonClient.rpc("can_view_project", { p_id: privProjAId, u_id: null as unknown as string }),
        anonClient.rpc("claim_project_render_job", { p_job_id: null }),
        anonClient.rpc("is_authorized_render_worker", { u_id: worker1Id }),
      ]);

      if (
        !anonPubProj.error &&
        anonPubProj.data?.id === projAId &&
        anonPrivProj.data === null &&
        anonDraftProj.data === null &&
        anonCanViewPub.data === true &&
        anonCanViewPriv.data === false &&
        Boolean(anonClaimRpc.error) &&
        Boolean(anonWorkerCheckRpc.error)
      ) {
        record(
          "Scenario 4",
          "Unauthenticated (anon) Public Project Access & Private/Draft/Worker Isolation",
          "PASS",
          "anon read public non-draft project, was denied private & draft projects, and received permission denied on worker RPCs"
        );
      } else {
        record(
          "Scenario 4",
          "Unauthenticated (anon) Public Project Access & Private/Draft/Worker Isolation",
          "FAIL",
          `pub=${anonPubProj.data?.id}, priv=${anonPrivProj.data?.id}, draft=${anonDraftProj.data?.id}, claimErr=${!!anonClaimRpc.error}, workerCheckErr=${!!anonWorkerCheckRpc.error}`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 4",
        "Unauthenticated (anon) Public Project Access & Private/Draft/Worker Isolation",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 5: Storage Media Privacy for Posts (Followers-Only, Draft, Private, Restricted, Blocked)
    // =========================================================================
    console.log("\n--- Scenario 5: Storage Media Privacy for Posts ---");
    try {
      const followersMedia = `${userAId}/p02-stage-followers-post-${Date.now()}.mp4`;
      const draftMedia = `${userAId}/p02-stage-draft-post-${Date.now()}.mp4`;
      const privateMedia = `${userAId}/p02-stage-private-post-${Date.now()}.mp4`;
      const publicMedia = `${userAId}/p02-stage-public-post-${Date.now()}.mp4`;

      await Promise.all([
        clientA.storage.from("media").upload(followersMedia, blueBytes, { contentType: "video/mp4", upsert: true }),
        clientA.storage.from("media").upload(draftMedia, blueBytes, { contentType: "video/mp4", upsert: true }),
        clientA.storage.from("media").upload(privateMedia, blueBytes, { contentType: "video/mp4", upsert: true }),
        clientA.storage.from("media").upload(publicMedia, blueBytes, { contentType: "video/mp4", upsert: true }),
      ]);
      cleanupStorage.push(
        { client: clientA, path: followersMedia },
        { client: clientA, path: draftMedia },
        { client: clientA, path: privateMedia },
        { client: clientA, path: publicMedia }
      );

      const [fPost, dPost, pPost, pubPost] = await Promise.all([
        clientA
          .from("posts")
          .insert({
            creator_id: userAId,
            content_type: "short_video",
            caption: "Followers post media test",
            media_path: followersMedia,
            status: "published",
            visibility: "followers",
            published_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
        clientA
          .from("posts")
          .insert({
            creator_id: userAId,
            content_type: "short_video",
            caption: "Draft public post media test",
            media_path: draftMedia,
            status: "draft",
            visibility: "public",
          })
          .select("id")
          .single(),
        clientA
          .from("posts")
          .insert({
            creator_id: userAId,
            content_type: "short_video",
            caption: "Private post media test",
            media_path: privateMedia,
            status: "published",
            visibility: "private",
            published_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
        clientA
          .from("posts")
          .insert({
            creator_id: userAId,
            content_type: "short_video",
            caption: "Public post media test",
            media_path: publicMedia,
            status: "published",
            visibility: "public",
            published_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
      ]);

      for (const row of [fPost.data, dPost.data, pPost.data, pubPost.data]) {
        if (row?.id) cleanupPosts.push({ client: clientA, id: row.id });
      }

      // Ensure clean relationship between User A and User E
      await clientA.from("follows").delete().or(`follower_id.eq.${userEId},following_id.eq.${userEId}`);
      await clientA.from("blocks").delete().or(`blocker_id.eq.${userEId},blocked_id.eq.${userEId}`);

      // 1. Non-follower User E: cannot read followers, draft, or private post media; CAN read public post media
      const [nonFolSign, draftSignE, privSignE, pubSignE] = await Promise.all([
        clientE.storage.from("media").createSignedUrl(followersMedia, 60),
        clientE.storage.from("media").createSignedUrl(draftMedia, 60),
        clientE.storage.from("media").createSignedUrl(privateMedia, 60),
        clientE.storage.from("media").createSignedUrl(publicMedia, 60),
      ]);

      // 2. Pending follower User E: still cannot read followers post media
      await clientE.from("follows").insert({
        follower_id: userEId,
        following_id: userAId,
        status: "pending",
      });
      const pendingFolSign = await clientE.storage.from("media").createSignedUrl(followersMedia, 60);

      // 3. Accepted follower User E: CAN read followers post media, still CANNOT read private or draft post media
      await clientA
        .from("follows")
        .update({ status: "accepted" })
        .eq("follower_id", userEId)
        .eq("following_id", userAId);
      const [acceptedFolSign, acceptedPrivSign, acceptedDraftSign] = await Promise.all([
        clientE.storage.from("media").createSignedUrl(followersMedia, 60),
        clientE.storage.from("media").createSignedUrl(privateMedia, 60),
        clientE.storage.from("media").createSignedUrl(draftMedia, 60),
      ]);

      // 4. Block User E: cannot read public or followers media
      await clientA.from("blocks").insert({ blocker_id: userAId, blocked_id: userEId });
      const blockedPubSign = await clientE.storage.from("media").createSignedUrl(publicMedia, 60);
      await clientA.from("blocks").delete().eq("blocker_id", userAId).eq("blocked_id", userEId);
      await clientA.from("follows").delete().eq("follower_id", userEId).eq("following_id", userAId);

      if (
        Boolean(nonFolSign.error) &&
        Boolean(draftSignE.error) &&
        Boolean(privSignE.error) &&
        !pubSignE.error &&
        Boolean(pubSignE.data?.signedUrl) &&
        Boolean(pendingFolSign.error) &&
        !acceptedFolSign.error &&
        Boolean(acceptedFolSign.data?.signedUrl) &&
        Boolean(acceptedPrivSign.error) &&
        Boolean(acceptedDraftSign.error) &&
        Boolean(blockedPubSign.error)
      ) {
        record(
          "Scenario 5",
          "Storage Media Privacy for Posts (Followers-Only, Draft, Private & Block)",
          "PASS",
          "Enforced audience checks for followers-only (non-follower/pending denied, accepted allowed), draft/private (non-owner denied), and blocked viewer (denied)"
        );
      } else {
        record(
          "Scenario 5",
          "Storage Media Privacy for Posts (Followers-Only, Draft, Private & Block)",
          "FAIL",
          `nonFolErr=${!!nonFolSign.error}, draftErr=${!!draftSignE.error}, privErr=${!!privSignE.error}, pubOk=${!!pubSignE.data?.signedUrl}, pendingErr=${!!pendingFolSign.error}, acceptedOk=${!!acceptedFolSign.data?.signedUrl}, blockedErr=${!!blockedPubSign.error}`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 5",
        "Storage Media Privacy for Posts (Followers-Only, Draft, Private & Block)",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 6: Storage Media Privacy for Projects (Private vs Public, Pending vs Approved)
    // =========================================================================
    console.log("\n--- Scenario 6: Storage Media Privacy for Projects ---");
    try {
      const privProjClip = `${userCId}/p02-s6-priv-clip-${Date.now()}.mp4`;
      const pubPendingClip = `${userCId}/p02-s6-pub-pending-${Date.now()}.mp4`;
      const pubApprovedClip = `${userCId}/p02-s6-pub-approved-${Date.now()}.mp4`;

      await Promise.all([
        clientC.storage.from("media").upload(privProjClip, redBytes, { contentType: "video/mp4", upsert: true }),
        clientC.storage.from("media").upload(pubPendingClip, redBytes, { contentType: "video/mp4", upsert: true }),
        clientC.storage.from("media").upload(pubApprovedClip, redBytes, { contentType: "video/mp4", upsert: true }),
      ]);
      cleanupStorage.push(
        { client: clientC, path: privProjClip },
        { client: clientC, path: pubPendingClip },
        { client: clientC, path: pubApprovedClip }
      );

      // Create open Private Project and open Public Project for Scenario 6 media privacy tests
      const [{ data: s6PrivProj }, { data: s6PubProj }] = await Promise.all([
        clientA
          .from("collaborative_projects")
          .insert({
            creator_id: userAId,
            title: `P0-2 S6 Private Project ${Date.now()}`,
            visibility: "private",
            participation_mode: "invite_only",
            status: "open",
          })
          .select("id")
          .single(),
        clientA
          .from("collaborative_projects")
          .insert({
            creator_id: userAId,
            title: `P0-2 S6 Public Project ${Date.now()}`,
            visibility: "public",
            participation_mode: "open",
            status: "open",
          })
          .select("id")
          .single(),
      ]);

      cleanupProjects.push(
        { client: clientA, id: s6PrivProj!.id },
        { client: clientA, id: s6PubProj!.id }
      );

      await Promise.all([
        clientA.from("project_participants").insert({
          project_id: s6PrivProj!.id,
          user_id: userCId,
          role: "contributor",
          status: "invited",
          invited_by: userAId,
        }),
        clientC.from("project_participants").insert({
          project_id: s6PubProj!.id,
          user_id: userCId,
          role: "contributor",
          status: "active",
        }),
      ]);
      await clientC
        .from("project_participants")
        .update({ status: "active" })
        .eq("project_id", s6PrivProj!.id)
        .eq("user_id", userCId);

      const [insPrivClip, insPubPending, insPubApproved] = await Promise.all([
        clientC
          .from("project_contributions")
          .insert({
            project_id: s6PrivProj!.id,
            contributor_id: userCId,
            media_path: privProjClip,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientC
          .from("project_contributions")
          .insert({
            project_id: s6PubProj!.id,
            contributor_id: userCId,
            media_path: pubPendingClip,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientC
          .from("project_contributions")
          .insert({
            project_id: s6PubProj!.id,
            contributor_id: userCId,
            media_path: pubApprovedClip,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
      ]);

      await Promise.all([
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
          .eq("id", insPrivClip.data!.id),
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
          .eq("id", insPubApproved.data!.id),
      ]);

      // Fetch the completed output path of privProjAId from Scenario 1
      const { data: privProjRow } = await clientA
        .from("collaborative_projects")
        .select("output_media_path")
        .eq("id", privProjAId)
        .single();
      const privOutPath = privProjRow?.output_media_path || "";

      // Non-participant User E checks:
      // - Private project approved clip -> DENIED
      // - Private project completed output -> DENIED
      // - Public project pending (unapproved) clip -> DENIED
      // - Public project approved clip -> ALLOWED
      // Active participant User A checks:
      // - Private project approved clip -> ALLOWED
      // - Private project completed output -> ALLOWED
      // - Public project pending clip -> ALLOWED
      const [
        ePrivClip,
        ePrivOut,
        ePubPending,
        ePubApproved,
        aPrivClip,
        aPrivOut,
        aPubPending,
      ] = await Promise.all([
        clientE.storage.from("media").createSignedUrl(privProjClip, 60),
        clientE.storage.from("media").createSignedUrl(privOutPath, 60),
        clientE.storage.from("media").createSignedUrl(pubPendingClip, 60),
        clientE.storage.from("media").createSignedUrl(pubApprovedClip, 60),
        clientA.storage.from("media").createSignedUrl(privProjClip, 60),
        clientA.storage.from("media").createSignedUrl(privOutPath, 60),
        clientA.storage.from("media").createSignedUrl(pubPendingClip, 60),
      ]);

      if (
        Boolean(ePrivClip.error) &&
        Boolean(ePrivOut.error) &&
        Boolean(ePubPending.error) &&
        !ePubApproved.error &&
        Boolean(ePubApproved.data?.signedUrl) &&
        !aPrivClip.error &&
        Boolean(aPrivClip.data?.signedUrl) &&
        !aPrivOut.error &&
        Boolean(aPrivOut.data?.signedUrl) &&
        !aPubPending.error &&
        Boolean(aPubPending.data?.signedUrl)
      ) {
        record(
          "Scenario 6",
          "Storage Media Privacy for Projects (Private Project & Unapproved Clip Isolation)",
          "PASS",
          "Non-participant denied private project clips, private project output, and public project unapproved clips; active participant granted access"
        );
      } else {
        record(
          "Scenario 6",
          "Storage Media Privacy for Projects (Private Project & Unapproved Clip Isolation)",
          "FAIL",
          `ePrivClipErr=${!!ePrivClip.error}, ePrivOutErr=${!!ePrivOut.error}, ePubPendingErr=${!!ePubPending.error}, ePubAppOk=${!!ePubApproved.data?.signedUrl}, aPrivClipOk=${!!aPrivClip.data?.signedUrl}`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 6",
        "Storage Media Privacy for Projects (Private Project & Unapproved Clip Isolation)",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 7: Consent Withdrawal, Participant Removal, Block, Deactivation, Cancellation & Tampering
    // =========================================================================
    console.log("\n--- Scenario 7: Consent Withdrawal, Removal, Block, Deactivation, Cancellation & Tampering ---");
    try {
      // Create a dedicated test project owned by User A with contributors User C and User F
      const { data: s7Proj } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 S7 Safety Lifecycle Project ${Date.now()}`,
          visibility: "public",
          participation_mode: "open",
        })
        .select("id")
        .single();
      const s7ProjId = s7Proj!.id;
      cleanupProjects.push({ client: clientA, id: s7ProjId });

      await Promise.all([
        clientC.from("project_participants").insert({
          project_id: s7ProjId,
          user_id: userCId,
          role: "contributor",
          status: "active",
        }),
        clientF.from("project_participants").insert({
          project_id: s7ProjId,
          user_id: userFId,
          role: "contributor",
          status: "active",
        }),
      ]);

      const [s7ClipA, s7ClipC] = await Promise.all([
        clientA
          .from("project_contributions")
          .insert({
            project_id: s7ProjId,
            contributor_id: userAId,
            media_path: clipAPath,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
        clientC
          .from("project_contributions")
          .insert({
            project_id: s7ProjId,
            contributor_id: userCId,
            media_path: clipCPath,
            media_type: "short_video",
            media_metadata: DEFAULT_VIDEO_META,
            consent_granted: true,
            consent_policy_version: "v1.0-collaborative-2026",
          })
          .select("id")
          .single(),
      ]);

      await Promise.all([
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
          .eq("id", s7ClipA.data!.id),
        clientA
          .from("project_contributions")
          .update({ review_status: "approved", sequence_order: 2, reviewed_by: userAId })
          .eq("id", s7ClipC.data!.id),
      ]);

      // 7A. Participant removal after job is queued -> trigger/claim aborts & marks job failed
      const { data: jobRemoval } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: s7ProjId,
          requested_by: userAId,
          idempotency_key: `p02-s7-removal-${Date.now()}`,
        })
        .select("id")
        .single();

      // Remove User C from project_participants while job is queued
      // Note: handle_project_participant_inactive withdraws User C's contributions, which cascades to abort jobRemoval!
      await clientA
        .from("project_participants")
        .update({ status: "removed" })
        .eq("project_id", s7ProjId)
        .eq("user_id", userCId);

      const { data: jobAfterRemoval } = await clientA
        .from("project_render_jobs")
        .select("status")
        .eq("id", jobRemoval!.id)
        .single();

      // Restore User C to active participant (editor invites -> participant accepts) and submit a fresh approved clip for User C
      await clientA
        .from("project_participants")
        .update({ status: "invited" })
        .eq("project_id", s7ProjId)
        .eq("user_id", userCId);
      await clientC
        .from("project_participants")
        .update({ status: "active" })
        .eq("project_id", s7ProjId)
        .eq("user_id", userCId);

      const { data: s7ClipC2, error: s7ClipC2Err } = await clientC
        .from("project_contributions")
        .insert({
          project_id: s7ProjId,
          contributor_id: userCId,
          media_path: clipCPath,
          media_type: "short_video",
          media_metadata: DEFAULT_VIDEO_META,
          consent_granted: true,
          consent_policy_version: "v1.0-collaborative-2026",
        })
        .select("id")
        .single();
      if (s7ClipC2Err || !s7ClipC2) {
        throw new Error(`s7ClipC2 insert failed: ${s7ClipC2Err?.message}`);
      }

      await clientA
        .from("project_contributions")
        .update({ review_status: "approved", sequence_order: 2, reviewed_by: userAId })
        .eq("id", s7ClipC2!.id);

      // 7B. Block between project owner (User A) and contributor (User C) while job is queued -> claim fails & marks job failed
      const { data: jobBlock } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: s7ProjId,
          requested_by: userAId,
          idempotency_key: `p02-s7-block-${Date.now()}`,
        })
        .select("id")
        .single();

      await clientA.from("blocks").insert({ blocker_id: userAId, blocked_id: userCId });
      const resBlock = await processProjectRenderJob(worker1Client, worker1Id, {
        jobId: jobBlock!.id,
      });
      await clientA.from("blocks").delete().eq("blocker_id", userAId).eq("blocked_id", userCId);

      // Reset s7ProjId status to 'open' if needed so next job can be queued
      await clientA
        .from("collaborative_projects")
        .update({ status: "open" })
        .eq("id", s7ProjId);

      // 7C. Manifest tampering attempt by claiming worker while job is 'processing' -> rejected by trigger, plus mid-render consent withdrawal
      const { data: jobTamper } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: s7ProjId,
          requested_by: userAId,
          idempotency_key: `p02-s7-tamper-${Date.now()}`,
        })
        .select("id")
        .single();

      let tamperRejected = false;
      const resWithdrawMid = await processProjectRenderJob(worker1Client, worker1Id, {
        jobId: jobTamper!.id,
        onBeforeCommit: async (claimedJob) => {
          // 1) Worker attempts to mutate input_manifest -> must be rejected by handle_project_render_job_update
          const { error: mutateManifestErr } = await worker1Client
            .from("project_render_jobs")
            .update({ input_manifest: [] })
            .eq("id", claimedJob.id);
          tamperRejected = Boolean(mutateManifestErr);

          // 2) Contributor User C withdraws consent right before commit -> must abort render completion
          await clientC
            .from("project_contributions")
            .update({
              consent_granted: false,
              review_status: "withdrawn",
              withdrawal_reason: "Staging P0-2 mid-render withdrawal",
            })
            .eq("id", s7ClipC2!.id);
        },
      });

      // 7D. Contributor account deactivation (User F) revokes consent & aborts queued render
      const { data: s7ClipF } = await clientF
        .from("project_contributions")
        .insert({
          project_id: s7ProjId,
          contributor_id: userFId,
          media_path: clipFPath,
          media_type: "short_video",
          media_metadata: DEFAULT_VIDEO_META,
          consent_granted: true,
          consent_policy_version: "v1.0-collaborative-2026",
        })
        .select("id")
        .single();

      await clientA
        .from("project_contributions")
        .update({ review_status: "approved", sequence_order: 2, reviewed_by: userAId })
        .eq("id", s7ClipF!.id);

      const { data: jobDeact } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: s7ProjId,
          requested_by: userAId,
          idempotency_key: `p02-s7-deact-${Date.now()}`,
        })
        .select("id")
        .single();

      // User F deactivates their account while jobDeact is queued
      await clientF.rpc("request_or_execute_account_deletion", {
        p_mode: "deactivate_and_scrub",
        p_confirmation: "DEACTIVATE MY ACCOUNT",
      });

      const { data: jobAfterDeact } = await clientA
        .from("project_render_jobs")
        .select("status")
        .eq("id", jobDeact!.id)
        .single();

      // Reactivate User F immediately to restore clean baseline
      await clientF.rpc("reactivate_own_account", { p_display_name: "Test User F" });

      // 7E. Mid-render project cancellation (`onAfterClaim`)
      const { data: jobCancel } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: s7ProjId,
          requested_by: userAId,
          idempotency_key: `p02-s7-cancel-${Date.now()}`,
        })
        .select("id")
        .single();

      const resCancel = await processProjectRenderJob(worker1Client, worker1Id, {
        jobId: jobCancel!.id,
        onAfterClaim: async () => {
          await clientA
            .from("collaborative_projects")
            .update({ status: "cancelled" })
            .eq("id", s7ProjId);
        },
      });

      if (
        jobAfterRemoval?.status === "failed" &&
        resBlock.status === "failed" &&
        tamperRejected &&
        resWithdrawMid.status === "failed" &&
        resWithdrawMid.outputMediaPath === null &&
        jobAfterDeact?.status === "failed" &&
        resCancel.status === "failed"
      ) {
        record(
          "Scenario 7",
          "Consent Withdrawal, Removal, Block, Deactivation, Cancellation & Tampering",
          "PASS",
          "Rejected removed participant, blocked contributor, tampered manifest, mid-render consent withdrawal, deactivated contributor, and cancelled project with zero output exposure"
        );
      } else {
        record(
          "Scenario 7",
          "Consent Withdrawal, Removal, Block, Deactivation, Cancellation & Tampering",
          "FAIL",
          `removal=${jobAfterRemoval?.status}, block=${resBlock.status}(${resBlock.failureReason}), tamperRejected=${tamperRejected}, withdrawMid=${resWithdrawMid.status}, deact=${jobAfterDeact?.status}, cancel=${resCancel.status}`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 7",
        "Consent Withdrawal, Removal, Block, Deactivation, Cancellation & Tampering",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 8: Concurrent Worker Claim Safety & Cross-Worker Isolation
    // =========================================================================
    console.log("\n--- Scenario 8: Concurrent Worker Claim Safety & Cross-Worker Isolation ---");
    try {
      const { data: raceProj } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 S8 Multi-Worker Race Project ${Date.now()}`,
          visibility: "private",
          participation_mode: "invite_only",
        })
        .select("id")
        .single();
      const raceProjId = raceProj!.id;
      cleanupProjects.push({ client: clientA, id: raceProjId });

      const { data: raceClipA } = await clientA
        .from("project_contributions")
        .insert({
          project_id: raceProjId,
          contributor_id: userAId,
          media_path: clipAPath,
          media_type: "short_video",
          media_metadata: DEFAULT_VIDEO_META,
          consent_granted: true,
          consent_policy_version: "v1.0-collaborative-2026",
        })
        .select("id")
        .single();

      await clientA
        .from("project_contributions")
        .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
        .eq("id", raceClipA!.id);

      const { data: raceJob } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: raceProjId,
          requested_by: userAId,
          idempotency_key: `p02-s8-race-${Date.now()}`,
        })
        .select("id")
        .single();

      let crossWorkerIsolated = false;
      let crossWorkerDiag = "";

      const checkCrossWorkerInHook = async (claimedJob: { id: string; project_id: string }) => {
        const claimedByExpectedJob = claimedJob.id === raceJob!.id;
        // Identify whichever worker did NOT claim this job
        const { data: jobRow } = await clientA
          .from("project_render_jobs")
          .select("claimed_by")
          .eq("id", claimedJob.id)
          .single();
        const otherWorkerClient =
          jobRow?.claimed_by === worker1Id ? worker2Client : worker1Client;

        const forgedPath = buildCanonicalRenderOutputPath(
          userAId,
          claimedJob.project_id,
          claimedJob.id
        );

        const [
          otherWorkerProjRead,
          otherWorkerUpload,
          otherWorkerCompleteUpdate,
        ] = await Promise.all([
          otherWorkerClient
            .from("collaborative_projects")
            .select("id")
            .eq("id", claimedJob.project_id),
          otherWorkerClient.storage
            .from("media")
            .upload(forgedPath, blueBytes, { contentType: "video/mp4", upsert: false }),
          otherWorkerClient
            .from("project_render_jobs")
            .update({ status: "failed", failure_reason: "Cross-worker hijack attempt" })
            .eq("id", claimedJob.id)
            .select("id"),
        ]);

        crossWorkerIsolated =
          claimedByExpectedJob &&
          (otherWorkerProjRead.data?.length ?? 0) === 0 &&
          Boolean(otherWorkerUpload.error) &&
          (otherWorkerCompleteUpdate.data?.length ?? 0) === 0;

        crossWorkerDiag = `otherProjRows=${otherWorkerProjRead.data?.length}, otherUploadErr=${!!otherWorkerUpload.error}, otherUpdateRows=${otherWorkerCompleteUpdate.data?.length}`;
      };

      // Race Worker 1 and Worker 2 on the same queued job
      const [w1Res, w2Res] = await Promise.all([
        processProjectRenderJob(worker1Client, worker1Id, {
          jobId: raceJob!.id,
          onAfterClaim: checkCrossWorkerInHook,
        }),
        processProjectRenderJob(worker2Client, worker2Id, {
          jobId: raceJob!.id,
          onAfterClaim: checkCrossWorkerInHook,
        }),
      ]);

      const winner = w1Res.status === "completed" ? w1Res : w2Res;
      const loser = w1Res.status === "completed" ? w2Res : w1Res;
      if (winner.outputMediaPath) {
        cleanupStorage.push({ client: clientA, path: winner.outputMediaPath });
      }

      if (
        winner.status === "completed" &&
        winner.claimed === true &&
        loser.status === "skipped" &&
        loser.claimed === false &&
        crossWorkerIsolated
      ) {
        record(
          "Scenario 8",
          "Concurrent Worker Claim Safety & Cross-Worker Isolation",
          "PASS",
          `Exactly one worker claimed & completed job while second worker was skipped; non-claiming worker blocked from reading project, uploading output, or updating job (${crossWorkerDiag})`
        );
      } else {
        record(
          "Scenario 8",
          "Concurrent Worker Claim Safety & Cross-Worker Isolation",
          "FAIL",
          `w1=${w1Res.status}, w2=${w2Res.status}, crossWorkerIsolated=${crossWorkerIsolated} (${crossWorkerDiag})`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 8",
        "Concurrent Worker Claim Safety & Cross-Worker Isolation",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 9: Canonical Output Path Enforcement & Rollback Cleanup
    // =========================================================================
    console.log("\n--- Scenario 9: Canonical Output Path Enforcement & Rollback Cleanup ---");
    try {
      const { data: s9Proj } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 S9 Canonical Path Project ${Date.now()}`,
          visibility: "public",
          participation_mode: "open",
        })
        .select("id")
        .single();
      const s9ProjId = s9Proj!.id;
      cleanupProjects.push({ client: clientA, id: s9ProjId });

      const { data: s9Clip } = await clientA
        .from("project_contributions")
        .insert({
          project_id: s9ProjId,
          contributor_id: userAId,
          media_path: clipAPath,
          media_type: "short_video",
          media_metadata: DEFAULT_VIDEO_META,
          consent_granted: true,
          consent_policy_version: "v1.0-collaborative-2026",
        })
        .select("id")
        .single();

      await clientA
        .from("project_contributions")
        .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
        .eq("id", s9Clip!.id);

      const { data: s9Job } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: s9ProjId,
          requested_by: userAId,
          idempotency_key: `p02-s9-path-${Date.now()}`,
        })
        .select("id")
        .single();

      let pathChecksOk = false;
      let pathChecksDiag = "";

      const s9Res = await processProjectRenderJob(worker1Client, worker1Id, {
        jobId: s9Job!.id,
        onAfterClaim: async (claimedJob) => {
          // 1. Worker cannot upload normal user file to its own folder (allow_user_uploads = false)
          const ownFolderUpload = await worker1Client.storage
            .from("media")
            .upload(`${worker1Id}/worker-self-upload-${Date.now()}.mp4`, blueBytes, {
              contentType: "video/mp4",
              upsert: false,
            });

          // 2. Worker cannot upload arbitrary non-canonical file to creator's folder
          const arbitraryCreatorUpload = await worker1Client.storage
            .from("media")
            .upload(`${userAId}/arbitrary-${Date.now()}.mp4`, blueBytes, {
              contentType: "video/mp4",
              upsert: false,
            });

          // 3. Worker cannot upload canonical format with wrong job ID
          const wrongJobPath = buildCanonicalRenderOutputPath(
            userAId,
            s9ProjId,
            randomUUID()
          );
          const wrongJobUpload = await worker1Client.storage
            .from("media")
            .upload(wrongJobPath, blueBytes, {
              contentType: "video/mp4",
              upsert: false,
            });

          // 4. Worker CAN upload canonical format for the active claimed job and CAN delete it on rollback
          const validTempCanonicalPath = buildCanonicalRenderOutputPath(
            userAId,
            s9ProjId,
            claimedJob.id,
            "deadbeef"
          );
          const validCanonicalUpload = await worker1Client.storage
            .from("media")
            .upload(validTempCanonicalPath, blueBytes, {
              contentType: "video/mp4",
              upsert: false,
            });
          const validRollbackDelete = await worker1Client.storage
            .from("media")
            .remove([validTempCanonicalPath]);

          pathChecksOk =
            Boolean(ownFolderUpload.error) &&
            Boolean(arbitraryCreatorUpload.error) &&
            Boolean(wrongJobUpload.error) &&
            !validCanonicalUpload.error &&
            !validRollbackDelete.error &&
            (validRollbackDelete.data?.length ?? 0) === 1;

          pathChecksDiag = `ownFolderErr=${!!ownFolderUpload.error}, arbitraryErr=${!!arbitraryCreatorUpload.error}, wrongJobErr=${!!wrongJobUpload.error}, validUploadOk=${!validCanonicalUpload.error}, rollbackDeleted=${validRollbackDelete.data?.length}`;
        },
      });

      if (s9Res.outputMediaPath) {
        cleanupStorage.push({ client: clientA, path: s9Res.outputMediaPath });
      }

      if (s9Res.status === "completed" && pathChecksOk) {
        record(
          "Scenario 9",
          "Canonical Output Path Enforcement & Staged Rollback Cleanup",
          "PASS",
          `Blocked worker self-uploads, non-canonical paths, and mismatched job IDs; allowed exact canonical path upload and rollback delete (${pathChecksDiag})`
        );
      } else {
        record(
          "Scenario 9",
          "Canonical Output Path Enforcement & Staged Rollback Cleanup",
          "FAIL",
          `status=${s9Res.status}, pathChecksOk=${pathChecksOk} (${pathChecksDiag})`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 9",
        "Canonical Output Path Enforcement & Staged Rollback Cleanup",
        "FAIL",
        (err as Error).message
      );
    }

    // =========================================================================
    // SCENARIO 10: Ordinary User Rejection (Claim, Fail RPC, Direct Processing/Completion Transition)
    // =========================================================================
    console.log("\n--- Scenario 10: Ordinary User Rejection ---");
    try {
      const { data: s10Proj } = await clientA
        .from("collaborative_projects")
        .insert({
          creator_id: userAId,
          title: `P0-2 S10 Ordinary User Rejection Project ${Date.now()}`,
          visibility: "public",
          participation_mode: "open",
        })
        .select("id")
        .single();
      const s10ProjId = s10Proj!.id;
      cleanupProjects.push({ client: clientA, id: s10ProjId });

      const { data: s10Clip } = await clientA
        .from("project_contributions")
        .insert({
          project_id: s10ProjId,
          contributor_id: userAId,
          media_path: clipAPath,
          media_type: "short_video",
          media_metadata: DEFAULT_VIDEO_META,
          consent_granted: true,
          consent_policy_version: "v1.0-collaborative-2026",
        })
        .select("id")
        .single();

      await clientA
        .from("project_contributions")
        .update({ review_status: "approved", sequence_order: 1, reviewed_by: userAId })
        .eq("id", s10Clip!.id);

      const { data: s10Job } = await clientA
        .from("project_render_jobs")
        .insert({
          project_id: s10ProjId,
          requested_by: userAId,
          idempotency_key: `p02-s10-user-reject-${Date.now()}`,
        })
        .select("id")
        .single();
      const s10JobId = s10Job!.id;

      const forgedCanonicalOut = buildCanonicalRenderOutputPath(
        userAId,
        s10ProjId,
        s10JobId
      );

      // 1. Project owner User A and non-owner User B call claim_project_render_job -> BOTH REJECTED
      // 2. Project owner User A calls fail_invalid_queued_render_job -> REJECTED
      // 3. Project owner User A attempts direct UPDATE to 'processing' -> REJECTED
      // 4. Project owner User A attempts direct UPDATE to 'completed' -> REJECTED
      // 5. Non-staff User B queries render_workers -> 0 rows
      const [
        claimFromOwnerA,
        claimFromUserB,
        failRpcFromOwnerA,
        directProcessingFromOwnerA,
        directCompletedFromOwnerA,
        renderWorkersFromUserB,
      ] = await Promise.all([
        clientA.rpc("claim_project_render_job", { p_job_id: s10JobId }),
        clientB.rpc("claim_project_render_job", { p_job_id: s10JobId }),
        clientA.rpc("fail_invalid_queued_render_job", {
          p_job_id: s10JobId,
          p_failure_reason: "Forged fail attempt",
        }),
        clientA
          .from("project_render_jobs")
          .update({ status: "processing" })
          .eq("id", s10JobId),
        clientA
          .from("project_render_jobs")
          .update({ status: "completed", output_media_path: forgedCanonicalOut })
          .eq("id", s10JobId),
        clientB.from("render_workers").select("user_id"),
      ]);

      // Confirm job is still untouched in 'queued' state
      const { data: jobStillQueued } = await clientA
        .from("project_render_jobs")
        .select("status, claimed_by, output_media_path")
        .eq("id", s10JobId)
        .single();

      if (
        Boolean(claimFromOwnerA.error) &&
        Boolean(claimFromUserB.error) &&
        Boolean(failRpcFromOwnerA.error) &&
        Boolean(directProcessingFromOwnerA.error) &&
        Boolean(directCompletedFromOwnerA.error) &&
        (renderWorkersFromUserB.data?.length ?? 0) === 0 &&
        jobStillQueued?.status === "queued" &&
        jobStillQueued?.claimed_by === null
      ) {
        record(
          "Scenario 10",
          "Ordinary User & Project Editor Rejection on Worker Operations",
          "PASS",
          "Project owner and unrelated user rejected from claim_project_render_job, fail_invalid_queued_render_job, and direct transitions to 'processing' or 'completed'"
        );
      } else {
        record(
          "Scenario 10",
          "Ordinary User & Project Editor Rejection on Worker Operations",
          "FAIL",
          `claimOwnerErr=${!!claimFromOwnerA.error}, claimBErr=${!!claimFromUserB.error}, failRpcErr=${!!failRpcFromOwnerA.error}, directProcErr=${!!directProcessingFromOwnerA.error}, directCompErr=${!!directCompletedFromOwnerA.error}, jobStatus=${jobStillQueued?.status}`
        );
      }
    } catch (err: unknown) {
      record(
        "Scenario 10",
        "Ordinary User & Project Editor Rejection on Worker Operations",
        "FAIL",
        (err as Error).message
      );
    }
  } finally {
    // Clean up all staging test rows and storage objects
    for (const item of cleanupProjects) {
      try {
        await item.client.from("collaborative_projects").delete().eq("id", item.id);
      } catch {
        // Ignore cleanup error
      }
    }
    for (const item of cleanupPosts) {
      try {
        await item.client.from("posts").delete().eq("id", item.id);
      } catch {
        // Ignore cleanup error
      }
    }
    for (const item of cleanupStorage) {
      try {
        await item.client.storage.from("media").remove([item.path]);
      } catch {
        // Ignore cleanup error
      }
    }
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  }

  console.log("\n=== P0-2 STAGING DATABASE VERIFICATION SUMMARY ===");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`TOTAL SCENARIOS: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);

  if (failed > 0 || results.length < 10) {
    process.exit(1);
  }
}

runStagingVerification().catch((err) => {
  console.error("Fatal error in staging verification:", err);
  process.exit(1);
});
