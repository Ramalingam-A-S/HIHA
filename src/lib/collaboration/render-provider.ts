import {
  CURRENT_CONSENT_POLICY_VERSION,
  type RenderJobStatus,
  type RenderManifestItem,
} from "./types";

export interface StitchJobRequest {
  jobId: string;
  projectId: string;
  projectOwnerId: string;
  idempotencyKey: string;
  manifest: RenderManifestItem[];
  timeoutSeconds: number;
}

export interface StitchJobSubmissionResult {
  accepted: boolean;
  providerName: string;
  externalWorkerConfigured: boolean;
  status: RenderJobStatus;
  outputMediaPath?: string;
  failureReason?: string;
  diagnostics: string;
}

/**
 * Provider-neutral video stitching interface.
 *
 * Ensures that long-running FFmpeg transcoding or concatenation never runs inside
 * a synchronous Next.js Server Action. Implementations validate the ordered
 * manifest, confirm explicit consent metadata on every clip, and dispatch work
 * to an external asynchronous media worker queue (or record the queued job
 * contract when no external worker is provisioned).
 */
export interface VideoStitchingProvider {
  readonly providerName: string;
  readonly isExternalWorkerConfigured: boolean;

  /**
   * Validates that an input manifest contains at least one clip, preserves strictly
   * increasing sequence_order, and carries valid consent timestamps and storage paths.
   */
  validateManifest(manifest: RenderManifestItem[]): {
    valid: boolean;
    orderedManifest: RenderManifestItem[];
    error?: string;
  };

  /**
   * Dispatches or registers a durable render job without running synchronous
   * video transcoding in the Next.js request lifecycle.
   */
  enqueueRenderJob(request: StitchJobRequest): Promise<StitchJobSubmissionResult>;
}

const STORAGE_PATH_REGEX = /^[0-9a-fA-F-]{36}\/[a-zA-Z0-9._-]+$/;

/**
 * Validates and normalizes an ordered render manifest before worker dispatch.
 * Rejects empty manifests, missing consent timestamps, policy mismatches,
 * contributor/path scope mismatches, or duplicate sequence positions.
 */
export function validateAndOrderRenderManifest(
  manifest: RenderManifestItem[],
  expectedPolicyVersion: string = CURRENT_CONSENT_POLICY_VERSION
): {
  valid: boolean;
  orderedManifest: RenderManifestItem[];
  error?: string;
} {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    return {
      valid: false,
      orderedManifest: [],
      error: "Render manifest must contain at least one approved and consented contribution.",
    };
  }

  const seenContributionIds = new Set<string>();
  const seenSequenceOrders = new Set<number>();

  for (const item of manifest) {
    if (!item.contribution_id || !item.contributor_id) {
      return {
        valid: false,
        orderedManifest: [],
        error: "Manifest entry is missing contribution or contributor identity.",
      };
    }

    if (seenContributionIds.has(item.contribution_id)) {
      return {
        valid: false,
        orderedManifest: [],
        error: "Manifest contains duplicate contribution IDs.",
      };
    }
    seenContributionIds.add(item.contribution_id);

    if (!item.consent_granted_at || Number.isNaN(Date.parse(item.consent_granted_at))) {
      return {
        valid: false,
        orderedManifest: [],
        error: `Contribution ${item.contribution_id} is missing a valid consent timestamp.`,
      };
    }

    if (item.consent_policy_version !== expectedPolicyVersion) {
      return {
        valid: false,
        orderedManifest: [],
        error: `Contribution ${item.contribution_id} consent policy version mismatch.`,
      };
    }

    if (
      !item.media_path ||
      !STORAGE_PATH_REGEX.test(item.media_path) ||
      !item.media_path.startsWith(`${item.contributor_id}/`)
    ) {
      return {
        valid: false,
        orderedManifest: [],
        error: `Contribution ${item.contribution_id} has an invalid or unauthorized media storage path.`,
      };
    }

    if (
      typeof item.sequence_order !== "number" ||
      !Number.isInteger(item.sequence_order) ||
      item.sequence_order < 1
    ) {
      return {
        valid: false,
        orderedManifest: [],
        error: `Contribution ${item.contribution_id} has an invalid sequence order.`,
      };
    }

    if (seenSequenceOrders.has(item.sequence_order)) {
      return {
        valid: false,
        orderedManifest: [],
        error: `Duplicate sequence order ${item.sequence_order} detected in manifest.`,
      };
    }
    seenSequenceOrders.add(item.sequence_order);
  }

  const orderedManifest = [...manifest].sort(
    (a, b) => a.sequence_order - b.sequence_order
  );

  return {
    valid: true,
    orderedManifest,
  };
}

/**
 * Contract-Based Queue Adapter (`ContractQueueStitchingAdapter`).
 *
 * Used when no external FFmpeg media worker infrastructure is configured.
 * Enforces all manifest validation, consent checks, and ordering invariants,
 * and leaves the durable database job in `'queued'` status ready for an external
 * worker consumer without pretending that binary FFmpeg video stitching ran inside
 * Next.js.
 */
export class ContractQueueStitchingAdapter implements VideoStitchingProvider {
  readonly providerName = "contract-queue-adapter";
  readonly isExternalWorkerConfigured = false;

  validateManifest(manifest: RenderManifestItem[]) {
    return validateAndOrderRenderManifest(manifest);
  }

  async enqueueRenderJob(
    request: StitchJobRequest
  ): Promise<StitchJobSubmissionResult> {
    const validation = this.validateManifest(request.manifest);
    if (!validation.valid) {
      return {
        accepted: false,
        providerName: this.providerName,
        externalWorkerConfigured: false,
        status: "failed",
        failureReason: validation.error || "Invalid render manifest.",
        diagnostics: "Manifest validation failed prior to worker queue handoff.",
      };
    }

    return {
      accepted: true,
      providerName: this.providerName,
      externalWorkerConfigured: false,
      status: "queued",
      diagnostics:
        "Render job durably queued with validated manifest. Run the local FFmpeg worker (`npm run worker:render`) or configure an external worker consumer to process queued jobs.",
    };
  }
}

/**
 * External FFmpeg Worker Queue Adapter (`FfmpegWorkerQueueAdapter`).
 *
 * Used when `RENDER_WORKER_ENABLED=true` is configured in the server environment,
 * signaling that the standalone FFmpeg rendering worker (`scripts/run-render-worker.mts`
 * or container worker) is actively consuming durable `'queued'` jobs from
 * `public.project_render_jobs`. Never executes synchronous FFmpeg inside Next.js
 * Server Actions.
 */
export class FfmpegWorkerQueueAdapter implements VideoStitchingProvider {
  readonly providerName = "ffmpeg-worker-queue-adapter";
  readonly isExternalWorkerConfigured = true;

  validateManifest(manifest: RenderManifestItem[]) {
    return validateAndOrderRenderManifest(manifest);
  }

  async enqueueRenderJob(
    request: StitchJobRequest
  ): Promise<StitchJobSubmissionResult> {
    const validation = this.validateManifest(request.manifest);
    if (!validation.valid) {
      return {
        accepted: false,
        providerName: this.providerName,
        externalWorkerConfigured: true,
        status: "failed",
        failureReason: validation.error || "Invalid render manifest.",
        diagnostics: "Manifest validation failed prior to FFmpeg worker queue handoff.",
      };
    }

    return {
      accepted: true,
      providerName: this.providerName,
      externalWorkerConfigured: true,
      status: "queued",
      diagnostics:
        "Render job durably queued for asynchronous FFmpeg worker processing.",
    };
  }
}

export function createStitchingProvider(
  rawEnv: Record<string, string | undefined> = process.env
): VideoStitchingProvider {
  if (rawEnv.RENDER_WORKER_ENABLED === "true") {
    return new FfmpegWorkerQueueAdapter();
  }
  return new ContractQueueStitchingAdapter();
}

export const defaultStitchingProvider: VideoStitchingProvider =
  createStitchingProvider();

