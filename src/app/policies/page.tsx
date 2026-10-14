import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Privacy, Terms, Community Guidelines & Safety Policies | HIHA",
  description:
    "Versioned user-facing explanations of HIHA's privacy controls, data minimization, age-aware safety, AI content disclosure, and moderation appeals.",
};

const POLICY_DOCUMENT_VERSION = "1.4.0";
const POLICY_EFFECTIVE_DATE = "2026-10-13";

export default function PoliciesPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10 py-4">
      {/* Header */}
      <div className="border-b border-[var(--border)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-mono rounded-full bg-[var(--surface-muted)] text-[var(--accent)] border border-[var(--border-subtle)]">
            <span>Policy Version {POLICY_DOCUMENT_VERSION}</span>
            <span>•</span>
            <span>Effective {POLICY_EFFECTIVE_DATE}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
            Privacy, Safety &amp; Platform Governance Policies
          </h1>
          <p className="text-sm text-[var(--foreground-secondary)] max-w-2xl leading-relaxed">
            Clear, plain-language explanations of how HIHA protects user privacy, enforces age-appropriate boundaries, labels AI-generated or altered media, and handles content moderation and appeals.
          </p>
        </div>

        <Link
          href="/settings"
          className="shrink-0 py-2 px-3.5 text-xs font-semibold rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 transition-opacity"
        >
          Manage Privacy &amp; Data Settings →
        </Link>
      </div>

      {/* Quick Table of Contents */}
      <nav
        aria-label="Policy Sections"
        className="p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs"
      >
        <a href="#privacy-policy" className="p-2 rounded hover:bg-[var(--surface-muted)] font-medium">
          1. Privacy &amp; Data Minimization
        </a>
        <a href="#terms-of-use" className="p-2 rounded hover:bg-[var(--surface-muted)] font-medium">
          2. Terms of Use &amp; Eligibility
        </a>
        <a href="#age-safety" className="p-2 rounded hover:bg-[var(--surface-muted)] font-medium">
          3. Child &amp; Teen Safety Architecture
        </a>
        <a href="#community-guidelines" className="p-2 rounded hover:bg-[var(--surface-muted)] font-medium">
          4. Community Guidelines
        </a>
        <a href="#ai-disclosure" className="p-2 rounded hover:bg-[var(--surface-muted)] font-medium">
          5. AI Content Disclosure &amp; Provenance
        </a>
        <a href="#moderation-appeals" className="p-2 rounded hover:bg-[var(--surface-muted)] font-medium">
          6. Reporting, Enforcement &amp; Appeals
        </a>
      </nav>

      {/* 1. Privacy Policy */}
      <section
        id="privacy-policy"
        className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            1. Privacy Policy &amp; Data Minimization
          </h2>
          <span className="text-[11px] font-mono text-[var(--foreground-muted)]">
            v{POLICY_DOCUMENT_VERSION}
          </span>
        </div>
        <div className="space-y-3 text-xs text-[var(--foreground-secondary)] leading-relaxed">
          <p>
            <strong>Data Collected:</strong> HIHA collects only the account and content records needed to operate the platform: your authentication email, username, display name, optional biography, explicit topic interests, posts and uploaded media, collaborative project contributions and usage-consent records, relationship states (follows, blocks, mutes), and trust-and-safety reports or appeals.
          </p>
          <p>
            <strong>What We Never Collect:</strong> HIHA does not collect precise or public geolocation, device contact books, unrestricted private direct messages, cross-site advertising identifiers, or dates of birth.
          </p>
          <p>
            <strong>Audience &amp; Discoverability Controls:</strong> Every account can configure Profile Visibility (Public vs. Private), Member Directory Discoverability, Follow Permissions (<em>Everyone</em>, <em>Approval Required</em>, or <em>Nobody</em>), Content Interaction Permissions (<em>Everyone</em>, <em>Approved Followers Only</em>, or <em>Nobody</em>), and Default Post Visibility. These rules are enforced in PostgreSQL Row-Level Security (RLS) and server actions across feeds, profiles, communities, likes, collaborative video projects, and signed media playback URLs.
          </p>
          <p>
            <strong>Your Data Rights (Access, Portable Export &amp; Deletion):</strong> Authenticated users can inspect their stored data categories, download a machine-readable JSON export of their own personal data from{" "}
            <Link href="/settings" className="underline text-[var(--foreground)] font-medium">
              Privacy &amp; Data Settings
            </Link>
            , or execute immediate account deactivation/scrubbing or permanent deletion after password re-authentication.
          </p>
        </div>
      </section>

      {/* 2. Terms of Use */}
      <section
        id="terms-of-use"
        className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
      >
        <h2 className="text-lg font-bold text-[var(--foreground)]">
          2. Terms of Use &amp; Collaborative Licensing
        </h2>
        <div className="space-y-3 text-xs text-[var(--foreground-secondary)] leading-relaxed">
          <p>
            <strong>Account Responsibility:</strong> You are responsible for maintaining the security of your credentials and for content published under your account. Automated scraping, credential stuffing, and bypassing rate limits or access controls are prohibited.
          </p>
          <p>
            <strong>Collaborative Video Creation &amp; Revocable Consent:</strong> When you submit a video clip to a collaborative project on HIHA, your clip cannot be approved or stitched into a combined video unless you grant explicit usage consent for that specific project. You may withdraw your consent at any time before or after a collaborative render completes; withdrawing consent or deactivating/deleting your account automatically invalidates any rendered collaborative video output that included your contribution.
          </p>
        </div>
      </section>

      {/* 3. Child & Teen Safety Architecture */}
      <section
        id="age-safety"
        className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
      >
        <h2 className="text-lg font-bold text-[var(--foreground)]">
          3. Age-Aware Safety &amp; Zero-Knowledge Assurance Boundary
        </h2>
        <div className="space-y-3 text-xs text-[var(--foreground-secondary)] leading-relaxed">
          <p>
            <strong>Minimum Age Boundary (13+):</strong> HIHA requires all account holders to be at least 13 years old (or the applicable minimum digital consent age in their jurisdiction).
          </p>
          <p>
            <strong>Teen 13–17 Protective Experience:</strong> Accounts with{" "}
            <code className="font-mono">age_safety_mode = &apos;teen_13_17&apos;</code>{" "}
            are protected by database-enforced invariants:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Profile visibility is locked to <strong>Private</strong>.</li>
            <li>Public directory search discoverability is <strong>disabled</strong>.</li>
            <li>Incoming follows require <strong>explicit approval</strong> (or can be closed entirely).</li>
            <li>Content interactions (likes and collaborative project invitations) are restricted to <strong>approved followers only</strong> (or nobody).</li>
            <li>Publishing globally public posts or creating public collaborative projects is blocked at the database trigger layer.</li>
            <li>No unrestricted direct messaging or public location sharing is available on the platform.</li>
          </ul>
          <p>
            <strong>Honest Age Assurance Representation:</strong> Self-attestation at signup records a timestamp and activates protective defaults without collecting birth dates, but self-attestation does not cryptographically prove a user&apos;s legal age. Where jurisdictional regulations require verified age assurance, HIHA defines an external{" "}
            <code className="font-mono">AgeAssuranceProvider</code> contract designed to accept zero-knowledge age-bracket tokens without storing raw government IDs or biometric data on HIHA servers.
          </p>
        </div>
      </section>

      {/* 4. Community Guidelines */}
      <section
        id="community-guidelines"
        className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
      >
        <h2 className="text-lg font-bold text-[var(--foreground)]">
          4. Community Guidelines &amp; Responsible Participation
        </h2>
        <div className="space-y-3 text-xs text-[var(--foreground-secondary)] leading-relaxed">
          <p>
            HIHA is designed around intentional, topic-driven discovery rather than outrage amplification. Members agree not to post or share:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Harassment, targeted bullying, hate speech, or threats of violence.</li>
            <li>Child sexual exploitation or abuse material (CSAM) or any content endangering minors.</li>
            <li>Non-consensual intimate imagery, doxxing, or unauthorized personal data of others.</li>
            <li>Deceptive synthetic media intended to impersonate individuals or falsify civic or safety events.</li>
            <li>Spam, coordinated manipulation, or malicious links.</li>
          </ul>
        </div>
      </section>

      {/* 5. AI Content Disclosure */}
      <section
        id="ai-disclosure"
        className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
      >
        <h2 className="text-lg font-bold text-[var(--foreground)]">
          5. AI Content Disclosure &amp; Provenance Explanation
        </h2>
        <div className="space-y-3 text-xs text-[var(--foreground-secondary)] leading-relaxed">
          <p>
            <strong>Creator Declarations:</strong> Creators can label posts and collaborative video contributions as <em>AI-Generated</em>, <em>AI-Assisted / AI-Edited</em>, or <em>Materially Altered</em>, along with optional disclosure notes. When a collaborative video is stitched from multiple clips, the rendered output automatically aggregates all contributor AI disclosures into an immutable provenance manifest.
          </p>
          <p>
            <strong>No Unsupported Authenticity Claims:</strong> HIHA strictly separates creator self-declarations from machine-verified provenance (<code className="font-mono">authenticity_verification_status</code>). Content with no AI declaration is labeled <em>Not Declared</em>—never &ldquo;Verified Human-Created&rdquo;—because the absence of a self-declaration is not proof of origin.
          </p>
        </div>
      </section>

      {/* 6. Reporting, Moderation Enforcement & Appeals */}
      <section
        id="moderation-appeals"
        className="p-6 md:p-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
      >
        <h2 className="text-lg font-bold text-[var(--foreground)]">
          6. Reporting, Moderation Enforcement &amp; Appeals
        </h2>
        <div className="space-y-3 text-xs text-[var(--foreground-secondary)] leading-relaxed">
          <p>
            <strong>Reporting &amp; Scoped Authority:</strong> Any authenticated user can report posts, profiles, or misleading AI disclosures. Community moderators may moderate only within their assigned community; only verified platform staff can issue platform-wide content restrictions or temporary account suspensions.
          </p>
          <p>
            <strong>Immutable Audit Trail &amp; Expiration:</strong> Every moderation action records the acting staff member, target, reason, and explicit expiration window where applicable. Expired temporary restrictions automatically cease to block user actions.
          </p>
          <p>
            <strong>Appeals Process:</strong> Users affected by a moderation decision can view the restriction reason and submit an appeal via the{" "}
            <Link href="/moderation" className="underline text-[var(--foreground)] font-medium">
              Trust &amp; Safety Center
            </Link>{" "}
            without altering the original audit record.
          </p>
          <p>
            <strong>Post-Deletion Safety Retention:</strong> When an account is permanently deleted, personal profile data and posts are removed, while a non-identifying SHA-256 hash and action summary are retained in{" "}
            <code className="font-mono">moderation_retention_ledger</code> solely to prevent ban evasion and preserve platform safety statistics.
          </p>
        </div>
      </section>

      {/* Pre-Launch Legal Review Notice */}
      <section
        aria-label="Legal Review Disclaimer"
        className="p-5 rounded-[var(--radius-md)] border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-950 dark:text-amber-200 space-y-2"
      >
        <h3 className="font-bold">
          Engineering Policy Foundation — Pre-Launch Legal Counsel Review Required
        </h3>
        <p className="text-[11px] leading-relaxed">
          These policy explanations document HIHA&apos;s implemented technical privacy, child-safety, AI-transparency, and data-control mechanisms as of version {POLICY_DOCUMENT_VERSION}. They do not constitute formal legal advice or a guarantee of regulatory certification. Before commercial launch in specific jurisdictions, qualified legal counsel must review and finalize:
        </p>
        <ul className="list-disc pl-5 text-[11px] space-y-1">
          <li>Jurisdiction-specific age-of-consent thresholds and verifiable parental consent workflows (e.g., COPPA, UK Age Appropriate Design Code, EU DSA / GDPR Article 8, state age-assurance statutes).</li>
          <li>Certified third-party zero-knowledge age-assurance provider selection and data processing agreements (DPAs).</li>
          <li>Statutory retention windows for anonymized trust-and-safety ledger entries, law-enforcement preservation obligations, and formal Data Subject Access Request (DSAR) SLA disclosures.</li>
        </ul>
      </section>
    </div>
  );
}
