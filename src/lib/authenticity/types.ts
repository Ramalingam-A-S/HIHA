import { z } from "zod";

export const AI_DISCLOSURE_STATUSES = [
  "not_declared",
  "no_ai_declared",
  "ai_generated",
  "ai_assisted",
  "material_alteration",
] as const;

export type AiDisclosureStatus = (typeof AI_DISCLOSURE_STATUSES)[number];

export const PROVENANCE_STATUSES = [
  "unverified",
  "creator_declared",
  "machine_verified",
] as const;

export type ProvenanceStatus = (typeof PROVENANCE_STATUSES)[number];

export const MAX_AI_DISCLOSURE_DETAILS_LENGTH = 500;

export const aiDisclosureStatusSchema = z.enum(AI_DISCLOSURE_STATUSES, {
  message:
    "Invalid disclosure status. Must be not_declared, no_ai_declared, ai_generated, ai_assisted, or material_alteration.",
});

export const provenanceStatusSchema = z.enum(PROVENANCE_STATUSES);

export const aiDisclosureDetailsSchema = z
  .string()
  .trim()
  .max(
    MAX_AI_DISCLOSURE_DETAILS_LENGTH,
    `Disclosure details cannot exceed ${MAX_AI_DISCLOSURE_DETAILS_LENGTH} characters.`
  )
  .optional()
  .nullable()
  .transform((val) => (val && val.length > 0 ? val : null));

export interface AiDisclosureOptionMeta {
  value: AiDisclosureStatus;
  shortLabel: string;
  optionTitle: string;
  helperText: string;
}

export const AI_DISCLOSURE_OPTIONS: readonly AiDisclosureOptionMeta[] = [
  {
    value: "not_declared",
    shortLabel: "Origin not declared",
    optionTitle: "No declaration provided (Default)",
    helperText:
      "You have not made a declaration about AI use or material edits. Viewers will see that origin is undeclared (not verified as human-created).",
  },
  {
    value: "no_ai_declared",
    shortLabel: "Self-declared: No AI used",
    optionTitle: "No AI use declared",
    helperText:
      "Voluntarily declare that this content was created without generative AI or material synthetic alteration.",
  },
  {
    value: "ai_assisted",
    shortLabel: "Creator declared: AI-assisted / edited",
    optionTitle: "AI-assisted or AI-edited content",
    helperText:
      "Declare that AI tools assisted with editing, enhancement, scripting, voice/audio cleanup, or visual post-processing.",
  },
  {
    value: "ai_generated",
    shortLabel: "Creator declared: AI-generated",
    optionTitle: "AI-generated content",
    helperText:
      "Declare that this media or text was primarily generated using generative AI models.",
  },
  {
    value: "material_alteration",
    shortLabel: "Creator declared: Materially altered",
    optionTitle: "Material alteration (non-AI or composite edit)",
    helperText:
      "Declare that real-world footage, images, or audio were materially spliced, composited, or staged in a way that changes context.",
  },
] as const;

export interface AuthenticityDisplayInfo {
  status: AiDisclosureStatus;
  provenanceStatus: ProvenanceStatus;
  badgeLabel: string;
  provenanceLabel: string;
  description: string;
  details: string | null;
  tone: "neutral" | "info" | "amber" | "emerald";
  isDeclared: boolean;
  isMachineVerified: boolean;
}

/**
 * Produces clear, non-accusatory authenticity and disclosure copy.
 * Explicitly distinguishes 'not_declared' from 'no_ai_declared' and 'machine_verified'
 * so that lack of a declaration is never presented as proof of human origin.
 */
export function getAuthenticityDisplayInfo(
  status: AiDisclosureStatus = "not_declared",
  provenanceStatus: ProvenanceStatus = "unverified",
  details?: string | null
): AuthenticityDisplayInfo {
  const cleanDetails = details && details.trim().length > 0 ? details.trim() : null;
  const isMachineVerified = provenanceStatus === "machine_verified" && status !== "not_declared";

  const provenanceLabel = isMachineVerified
    ? "System-verified provenance"
    : status === "not_declared"
      ? "Unverified origin (no declaration)"
      : "Creator self-declaration (unverified)";

  switch (status) {
    case "not_declared":
      return {
        status,
        provenanceStatus: "unverified",
        badgeLabel: "Origin not declared",
        provenanceLabel,
        description:
          "The creator has not provided an AI or material-edit disclosure. Lack of a declaration is not proof that content is human-created or unaltered.",
        details: null,
        tone: "neutral",
        isDeclared: false,
        isMachineVerified: false,
      };
    case "no_ai_declared":
      return {
        status,
        provenanceStatus,
        badgeLabel: isMachineVerified
          ? "Verified provenance · No AI declared"
          : "Self-declared: No AI used",
        provenanceLabel,
        description: isMachineVerified
          ? "The creator declared no generative AI was used, and provenance metadata was verified for the current version of this post."
          : "The creator voluntarily declared that no generative AI was used. This reflects a creator statement and is not independent proof of origin.",
        details: cleanDetails,
        tone: isMachineVerified ? "emerald" : "info",
        isDeclared: true,
        isMachineVerified,
      };
    case "ai_assisted":
      return {
        status,
        provenanceStatus,
        badgeLabel: "Declared: AI-assisted / edited",
        provenanceLabel,
        description:
          "The creator disclosed that AI tools were used to assist, edit, or enhance this content.",
        details: cleanDetails,
        tone: "amber",
        isDeclared: true,
        isMachineVerified,
      };
    case "ai_generated":
      return {
        status,
        provenanceStatus,
        badgeLabel: "Declared: AI-generated",
        provenanceLabel,
        description:
          "The creator disclosed that this content was primarily generated using AI tools.",
        details: cleanDetails,
        tone: "amber",
        isDeclared: true,
        isMachineVerified,
      };
    case "material_alteration":
      return {
        status,
        provenanceStatus,
        badgeLabel: "Declared: Materially altered",
        provenanceLabel,
        description:
          "The creator disclosed that this content includes material edits, compositing, or context-changing alterations.",
        details: cleanDetails,
        tone: "amber",
        isDeclared: true,
        isMachineVerified,
      };
  }
}

export interface CollaborativeDisclosureBreakdown {
  not_declared: number;
  no_ai_declared: number;
  ai_generated: number;
  ai_assisted: number;
  material_alteration: number;
}

export interface CollaborativeSequenceProvenanceItem {
  sequence_order: number;
  ai_disclosure_status: AiDisclosureStatus;
}

export interface CollaborativeOutputProvenance {
  schema_version: string;
  render_job_id: string;
  rendered_at: string;
  total_included_clips: number;
  has_declared_ai_or_alteration: boolean;
  has_undeclared_clips: boolean;
  provenance_status: ProvenanceStatus;
  disclosure_breakdown: CollaborativeDisclosureBreakdown;
  included_sequences: CollaborativeSequenceProvenanceItem[];
}

export function parseCollaborativeOutputProvenance(
  raw: unknown
): CollaborativeOutputProvenance | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (
    typeof record.render_job_id !== "string" ||
    typeof record.total_included_clips !== "number" ||
    !record.disclosure_breakdown ||
    typeof record.disclosure_breakdown !== "object"
  ) {
    return null;
  }

  const breakdown = record.disclosure_breakdown as Record<string, unknown>;
  const rawSequences = Array.isArray(record.included_sequences)
    ? record.included_sequences
    : [];

  const includedSequences: CollaborativeSequenceProvenanceItem[] = rawSequences
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const seq = typeof obj.sequence_order === "number" ? obj.sequence_order : 1;
      const statusRaw = obj.ai_disclosure_status;
      const status: AiDisclosureStatus = AI_DISCLOSURE_STATUSES.includes(
        statusRaw as AiDisclosureStatus
      )
        ? (statusRaw as AiDisclosureStatus)
        : "not_declared";
      return {
        sequence_order: seq,
        ai_disclosure_status: status,
      };
    })
    .filter((item): item is CollaborativeSequenceProvenanceItem => item !== null);

  const provRaw = record.provenance_status;
  const provenanceStatus: ProvenanceStatus = PROVENANCE_STATUSES.includes(
    provRaw as ProvenanceStatus
  )
    ? (provRaw as ProvenanceStatus)
    : "unverified";

  return {
    schema_version:
      typeof record.schema_version === "string" ? record.schema_version : "1.0",
    render_job_id: record.render_job_id,
    rendered_at:
      typeof record.rendered_at === "string" ? record.rendered_at : "",
    total_included_clips: record.total_included_clips,
    has_declared_ai_or_alteration: Boolean(record.has_declared_ai_or_alteration),
    has_undeclared_clips: Boolean(record.has_undeclared_clips),
    provenance_status: provenanceStatus,
    disclosure_breakdown: {
      not_declared: Number(breakdown.not_declared) || 0,
      no_ai_declared: Number(breakdown.no_ai_declared) || 0,
      ai_generated: Number(breakdown.ai_generated) || 0,
      ai_assisted: Number(breakdown.ai_assisted) || 0,
      material_alteration: Number(breakdown.material_alteration) || 0,
    },
    included_sequences: includedSequences,
  };
}

export function formatCollaborativeProvenanceSummary(
  provenance: CollaborativeOutputProvenance
): {
  headline: string;
  detailLine: string;
  tone: "neutral" | "info" | "amber";
} {
  const { total_included_clips: total, disclosure_breakdown: b } = provenance;
  const parts: string[] = [];

  if (b.ai_generated > 0) {
    parts.push(`${b.ai_generated} AI-generated`);
  }
  if (b.ai_assisted > 0) {
    parts.push(`${b.ai_assisted} AI-assisted`);
  }
  if (b.material_alteration > 0) {
    parts.push(`${b.material_alteration} materially altered`);
  }
  if (b.no_ai_declared > 0) {
    parts.push(`${b.no_ai_declared} self-declared no AI`);
  }
  if (b.not_declared > 0) {
    parts.push(`${b.not_declared} undeclared origin`);
  }

  const breakdownText = parts.length > 0 ? parts.join(", ") : "no clips recorded";

  if (provenance.has_declared_ai_or_alteration) {
    return {
      headline: `Composite provenance (${total} stitched ${total === 1 ? "clip" : "clips"}): Includes declared AI or material edits`,
      detailLine: `Clip disclosures: ${breakdownText}. Derived from approved contributor declarations at render time.`,
      tone: "amber",
    };
  }

  if (b.no_ai_declared > 0 && b.not_declared === 0) {
    return {
      headline: `Composite provenance (${total} stitched ${total === 1 ? "clip" : "clips"}): All clips self-declared No AI used`,
      detailLine: `Clip disclosures: ${breakdownText}. Reflects contributor self-declarations; not independent verification.`,
      tone: "info",
    };
  }

  return {
    headline: `Composite provenance (${total} stitched ${total === 1 ? "clip" : "clips"}): Includes clips with undeclared origin`,
    detailLine: `Clip disclosures: ${breakdownText}. Undeclared clips are not verified as human-created.`,
    tone: "neutral",
  };
}

/**
 * Anti-manipulation ranking safeguard:
 * Dampens scores when a single creator submits a rapid burst of posts into the
 * ranked candidate pool so one account cannot monopolize top feed positions.
 *
 * - 1st and 2nd post from the same creator in the candidate pool: 1.0x
 * - 3rd post from the same creator: 0.85x
 * - 4th+ post from the same creator: 0.70x
 */
export function applyCreatorVelocityDampener<
  T extends {
    id: string;
    creatorId: string;
    score: number;
    publishedAt: string;
    explanationDetails: string[];
  },
>(scoredCandidates: T[]): T[] {
  const creatorOccurrence = new Map<string, number>();

  const adjusted = scoredCandidates.map((item) => {
    const seen = (creatorOccurrence.get(item.creatorId) ?? 0) + 1;
    creatorOccurrence.set(item.creatorId, seen);

    if (seen <= 2) {
      return item;
    }

    const multiplier = seen === 3 ? 0.85 : 0.7;
    const dampenedScore = Math.round(item.score * multiplier * 100) / 100;

    return {
      ...item,
      score: dampenedScore,
      explanationDetails: [
        ...item.explanationDetails,
        `Creator frequency safeguard applied (${multiplier}x diversity adjustment for post #${seen} from this creator)`,
      ],
    };
  });

  return adjusted.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const timeDiff =
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id.localeCompare(b.id);
  });
}
