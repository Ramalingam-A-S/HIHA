"use client";

import { useState } from "react";
import {
  getAuthenticityDisplayInfo,
  type AiDisclosureStatus,
  type ProvenanceStatus,
} from "@/lib/authenticity/types";

interface ContentAuthenticityBadgeProps {
  status?: AiDisclosureStatus | null;
  provenanceStatus?: ProvenanceStatus | null;
  details?: string | null;
  disclosedAt?: string | null;
  compact?: boolean;
}

export function ContentAuthenticityBadge({
  status = "not_declared",
  provenanceStatus = "unverified",
  details = null,
  disclosedAt = null,
  compact = false,
}: ContentAuthenticityBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  const info = getAuthenticityDisplayInfo(
    status ?? "not_declared",
    provenanceStatus ?? "unverified",
    details
  );

  const toneStyles: Record<typeof info.tone, string> = {
    neutral:
      "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80",
    info:
      "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100/80 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
    amber:
      "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100/80 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
    emerald:
      "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  };

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={`Content authenticity: ${info.badgeLabel}. Click for provenance details.`}
        className={`inline-flex items-center gap-1.5 rounded-full border transition-colors ${
          compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs"
        } font-medium ${toneStyles[info.tone]}`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            info.tone === "emerald"
              ? "bg-emerald-500"
              : info.tone === "amber"
                ? "bg-amber-500"
                : info.tone === "info"
                  ? "bg-sky-500"
                  : "bg-zinc-400"
          }`}
        />
        <span>{info.badgeLabel}</span>
        <span className="opacity-60" aria-hidden="true">
          {expanded ? "▲" : "ⓘ"}
        </span>
      </button>

      {expanded && (
        <div
          role="region"
          aria-label="Content authenticity and provenance explanation"
          className="mt-2 w-full max-w-md rounded-xl border border-zinc-200 bg-zinc-50/95 p-3 text-left text-xs text-zinc-700 shadow-xs dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-300"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/80 pb-1.5 dark:border-zinc-800">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {info.badgeLabel}
            </span>
            <span className="rounded-md bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {info.provenanceLabel}
            </span>
          </div>
          <p className="mt-1.5 leading-relaxed text-zinc-600 dark:text-zinc-400">
            {info.description}
          </p>
          {info.details && (
            <div className="mt-2 rounded-lg border border-zinc-200/80 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                Creator disclosure note
              </p>
              <p className="mt-0.5 text-xs text-zinc-800 dark:text-zinc-200">
                {info.details}
              </p>
            </div>
          )}
          {disclosedAt && info.isDeclared && (
            <p className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
              Disclosed {new Date(disclosedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
