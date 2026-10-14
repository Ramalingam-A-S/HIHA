import type { AgeAssuranceStatus, AgeSafetyMode } from "./types";

export interface AgeAssuranceEvaluation {
  eligibleForPlatform: boolean;
  recommendedSafetyMode: AgeSafetyMode;
  assuranceStatus: AgeAssuranceStatus;
  verifiedByExternalProvider: boolean;
  disclosureNotice: string;
}

export interface ExternalAgeAssuranceTokenPayload {
  subjectUserId: string;
  ageBracket: "under_13" | "teen_13_17" | "adult_18_plus";
  providerIssuer: string;
  issuedAtIso: string;
  expiresAtIso: string;
  signatureVerified: boolean;
}

/**
 * Provider-neutral contract for age eligibility and age-assurance integration.
 *
 * Architectural & Privacy Principles:
 * 1. Data Minimization: HIHA never collects, stores, or publicly exposes raw
 *    birth dates (date_of_birth), government ID numbers, or biometric media.
 * 2. Honest Assurance Representation: Self-attestation ('self_attested') activates
 *    protective safety defaults for 13–17 accounts ('teen_13_17') and records
 *    minimum-age eligibility confirmation, but is NEVER represented as cryptographic
 *    or legal proof of age.
 * 3. External Provider Boundary: Jurisdictions requiring formal age assurance
 *    (e.g., UK Children's Code, EU DSA Art. 28, state age-assurance statutes)
 *    must configure a certified external provider that issues a zero-knowledge
 *    age-bracket token ('under_13' | 'teen_13_17' | 'adult_18_plus') without
 *    transmitting raw identity documents or birth dates to HIHA.
 */
export interface AgeAssuranceProvider {
  readonly providerName: string;

  evaluateSelfAttestation(input: {
    minimumAgeConfirmed: boolean;
    requestedSafetyMode: AgeSafetyMode;
  }): AgeAssuranceEvaluation;

  evaluateExternalToken(
    token: ExternalAgeAssuranceTokenPayload,
    expectedUserId: string,
    nowMs?: number
  ): AgeAssuranceEvaluation;
}

export class SelfAttestationAgeAdapter implements AgeAssuranceProvider {
  public readonly providerName = "hiha-self-attestation-v1";

  public evaluateSelfAttestation(input: {
    minimumAgeConfirmed: boolean;
    requestedSafetyMode: AgeSafetyMode;
  }): AgeAssuranceEvaluation {
    if (!input.minimumAgeConfirmed) {
      return {
        eligibleForPlatform: false,
        recommendedSafetyMode: "teen_13_17",
        assuranceStatus: "unverified",
        verifiedByExternalProvider: false,
        disclosureNotice:
          "You must confirm that you are at least 13 years old (or the minimum legal age required in your jurisdiction) to create or use a HIHA account.",
      };
    }

    const mode: AgeSafetyMode =
      input.requestedSafetyMode === "teen_13_17" ? "teen_13_17" : "standard";

    return {
      eligibleForPlatform: true,
      recommendedSafetyMode: mode,
      assuranceStatus: "self_attested",
      verifiedByExternalProvider: false,
      disclosureNotice:
        mode === "teen_13_17"
          ? "Teen Protective Safety Mode (13–17) is active based on your account declaration. Self-attestation applies strict privacy defaults but does not constitute third-party legal age verification."
          : "Minimum-age eligibility is recorded via self-attestation. Self-attestation does not constitute third-party legal age verification.",
    };
  }

  public evaluateExternalToken(
    token: ExternalAgeAssuranceTokenPayload,
    expectedUserId: string,
    nowMs: number = Date.now()
  ): AgeAssuranceEvaluation {
    if (!token.signatureVerified || token.subjectUserId !== expectedUserId) {
      return {
        eligibleForPlatform: false,
        recommendedSafetyMode: "teen_13_17",
        assuranceStatus: "unverified",
        verifiedByExternalProvider: false,
        disclosureNotice:
          "External age-assurance token signature or subject binding could not be verified.",
      };
    }

    const expiresMs = Date.parse(token.expiresAtIso);
    if (Number.isNaN(expiresMs) || expiresMs <= nowMs) {
      return {
        eligibleForPlatform: false,
        recommendedSafetyMode: "teen_13_17",
        assuranceStatus: "unverified",
        verifiedByExternalProvider: false,
        disclosureNotice:
          "External age-assurance token has expired and must be refreshed.",
      };
    }

    if (token.ageBracket === "under_13") {
      return {
        eligibleForPlatform: false,
        recommendedSafetyMode: "teen_13_17",
        assuranceStatus: "provider_verified",
        verifiedByExternalProvider: true,
        disclosureNotice:
          "Accounts for children under 13 are not permitted on HIHA.",
      };
    }

    if (token.ageBracket === "teen_13_17") {
      return {
        eligibleForPlatform: true,
        recommendedSafetyMode: "teen_13_17",
        assuranceStatus: "provider_verified",
        verifiedByExternalProvider: true,
        disclosureNotice: `Provider-verified teen bracket (${token.providerIssuer}): Teen Protective Safety Mode is enforced without storing your birth date.`,
      };
    }

    return {
      eligibleForPlatform: true,
      recommendedSafetyMode: "standard",
      assuranceStatus: "provider_verified",
      verifiedByExternalProvider: true,
      disclosureNotice: `Provider-verified adult eligibility (${token.providerIssuer}) recorded via zero-knowledge bracket token without storing your birth date.`,
    };
  }
}

export const defaultAgeAssuranceProvider: AgeAssuranceProvider =
  new SelfAttestationAgeAdapter();
