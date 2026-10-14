"use client";

import {
  AI_DISCLOSURE_OPTIONS,
  MAX_AI_DISCLOSURE_DETAILS_LENGTH,
  type AiDisclosureStatus,
} from "@/lib/authenticity/types";

interface AiDisclosureSelectorProps {
  status: AiDisclosureStatus;
  details: string;
  onStatusChange: (status: AiDisclosureStatus) => void;
  onDetailsChange: (details: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function AiDisclosureSelector({
  status,
  details,
  onStatusChange,
  onDetailsChange,
  disabled = false,
  compact = false,
}: AiDisclosureSelectorProps) {
  const selectedMeta =
    AI_DISCLOSURE_OPTIONS.find((opt) => opt.value === status) ??
    AI_DISCLOSURE_OPTIONS[0];

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Content Authenticity &amp; AI Disclosure
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Help viewers understand whether generative AI or material edits were used. Undeclared content is shown as unverified origin.
          </p>
        </div>
        <span className="rounded-full bg-zinc-200/80 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {selectedMeta.shortLabel}
        </span>
      </div>

      <div
        className={`grid gap-2 ${
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
        }`}
        role="radiogroup"
        aria-label="AI and material alteration disclosure options"
      >
        {AI_DISCLOSURE_OPTIONS.map((opt) => {
          const isSelected = status === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => {
                onStatusChange(opt.value);
                if (opt.value === "not_declared") {
                  onDetailsChange("");
                }
              }}
              className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition-all ${
                isSelected
                  ? "border-zinc-900 bg-white shadow-xs dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-zinc-200 bg-white/60 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:border-zinc-700"
              }`}
            >
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {opt.optionTitle}
              </span>
              <span className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                {opt.helperText}
              </span>
            </button>
          );
        })}
      </div>

      {status !== "not_declared" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Voluntary Disclosure Details{" "}
            <span className="font-normal text-zinc-400">
              (Optional · e.g. tools used, editing workflow, or context)
            </span>
          </label>
          <textarea
            rows={2}
            maxLength={MAX_AI_DISCLOSURE_DETAILS_LENGTH}
            disabled={disabled}
            value={details}
            onChange={(e) => onDetailsChange(e.target.value)}
            placeholder="Describe how AI or editing tools were used (up to 500 characters)..."
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <div className="mt-1 text-right text-[11px] text-zinc-400">
            {details.length} / {MAX_AI_DISCLOSURE_DETAILS_LENGTH}
          </div>
        </div>
      )}
    </div>
  );
}
