"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPostAction } from "@/app/actions/posts";
import {
  type SupportedMediaType,
  MEDIA_CONSTRAINTS,
} from "@/lib/storage/types";
import {
  INTEREST_CATEGORIES,
  type InterestCategoryId,
} from "@/lib/validations/interests";
import { AiDisclosureSelector } from "@/components/authenticity/AiDisclosureSelector";
import type { AiDisclosureStatus } from "@/lib/authenticity/types";
import type { Interest } from "@/lib/supabase/types";

interface CreatePostFormProps {
  availableInterests: Interest[];
  defaultVisibility?: "public" | "followers" | "private";
  ageSafetyMode?: "standard" | "teen_13_17";
}

export function CreatePostForm({
  availableInterests,
  defaultVisibility = "public",
  ageSafetyMode = "standard",
}: CreatePostFormProps) {
  const router = useRouter();
  const isTeenProtected = ageSafetyMode === "teen_13_17";
  const initialVisibility =
    isTeenProtected && defaultVisibility === "public"
      ? "followers"
      : defaultVisibility;
  const [contentType, setContentType] = useState<
    "text" | SupportedMediaType
  >("text");
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<
    "public" | "followers" | "private"
  >(initialVisibility);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedInterestIds, setSelectedInterestIds] = useState<string[]>([]);
  const [aiDisclosureStatus, setAiDisclosureStatus] =
    useState<AiDisclosureStatus>("not_declared");
  const [aiDisclosureDetails, setAiDisclosureDetails] = useState("");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
    errors?: Record<string, string[]>;
  } | null>(null);

  const filteredInterests = selectedCategory
    ? availableInterests.filter((i) => i.category === selectedCategory)
    : availableInterests;

  const toggleInterest = (id: string) => {
    if (selectedInterestIds.includes(id)) {
      setSelectedInterestIds((prev) => prev.filter((item) => item !== id));
    } else {
      if (selectedInterestIds.length >= 5) {
        return;
      }
      setSelectedInterestIds((prev) => [...prev, id]);
    }
  };

  const handleSubmit = (status: "draft" | "published") => {
    setFeedback(null);
    startTransition(async () => {
      const payload = {
        content_type: contentType,
        caption: caption.trim() || undefined,
        status,
        visibility,
        category: (selectedCategory as InterestCategoryId) || undefined,
        interestIds:
          selectedInterestIds.length > 0 ? selectedInterestIds : undefined,
        ai_disclosure_status: aiDisclosureStatus,
        ai_disclosure_details:
          aiDisclosureStatus === "not_declared"
            ? null
            : aiDisclosureDetails.trim() || null,
      };

      const res = await createPostAction(payload);
      if (res.success) {
        setFeedback({
          type: "success",
          text: res.message || "Post created successfully.",
        });
        setCaption("");
        setSelectedInterestIds([]);
        setAiDisclosureStatus("not_declared");
        setAiDisclosureDetails("");
        router.refresh();
      } else {
        setFeedback({
          type: "error",
          text: res.message || "Failed to create post.",
          errors: res.errors,
        });
      }
    });
  };

  return (
    <div className="space-y-6 bg-[var(--surface)] p-6 rounded-[var(--radius-md)] border border-[var(--border)]">
      {/* Feedback Alert */}
      {feedback && (
        <div
          role="status"
          className={`p-4 rounded-[var(--radius-sm)] text-xs border ${
            feedback.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900"
              : "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-900"
          }`}
        >
          <p className="font-semibold">{feedback.text}</p>
          {feedback.errors && (
            <ul className="list-disc pl-4 mt-2 space-y-1">
              {Object.entries(feedback.errors).map(([field, errs]) => (
                <li key={field}>
                  <strong className="capitalize">{field}:</strong> {errs.join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Content Type Selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Content Format
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              { id: "text", label: "Text Thought", badge: "Active" },
              { id: "image", label: "Image Post", badge: "10 MB" },
              { id: "short_video", label: "Short Video", badge: "≤60s / 100MB" },
              { id: "long_video", label: "Long Video", badge: "500 MB" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setContentType(t.id)}
              className={`p-3 rounded-[var(--radius-sm)] border text-left flex flex-col justify-between transition-colors ${
                contentType === t.id
                  ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--foreground)]"
                  : "border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--border-subtle)]"
              }`}
            >
              <span className="text-xs font-semibold">{t.label}</span>
              <span className="text-[10px] font-mono mt-1 opacity-70">
                {t.badge}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Media Upload Placeholder for Non-Text Formats */}
      {contentType !== "text" && (
        <div className="p-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--foreground-secondary)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--foreground)]">
              Direct-to-Storage Media Pipeline
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">
              Max {Math.round(MEDIA_CONSTRAINTS[contentType].maxSizeBytes / (1024 * 1024))}MB
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--foreground-muted)]">
            Media uploads use signed URLs directly to private storage. Text posts can be published immediately; media posts require media attachment in draft mode.
          </p>
        </div>
      )}

      {/* Caption / Content Area */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="caption"
            className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]"
          >
            {contentType === "text" ? "Thought / Reflection *" : "Caption"}
          </label>
          <span
            className={`text-[10px] font-mono ${
              caption.length > 2100
                ? "text-red-500 font-bold"
                : "text-[var(--foreground-muted)]"
            }`}
          >
            {caption.length} / 2,200
          </span>
        </div>
        <textarea
          id="caption"
          rows={5}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={
            contentType === "text"
              ? "Share thoughtful perspectives, questions, or ideas..."
              : "Add context or narrative for your media..."
          }
          className="w-full p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)] resize-y"
        />
      </div>

      {/* Audience Visibility */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
            Audience Visibility
          </label>
          {isTeenProtected && (
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              Teen 13–17 Safety Active: Public Posts Disabled
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            {
              id: "public",
              title: "Public",
              desc: isTeenProtected
                ? "Unavailable while Teen 13–17 Protective Mode is enabled."
                : "Accessible to everyone except accounts you have blocked.",
              disabled: isTeenProtected,
            },
            {
              id: "followers",
              title: "Followers Only",
              desc: "Requires an accepted follow relationship.",
              disabled: false,
            },
            {
              id: "private",
              title: "Private (Only Me)",
              desc: "Personal journal or preview draft.",
              disabled: false,
            },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={v.disabled}
              onClick={() =>
                !v.disabled &&
                setVisibility(v.id as "public" | "followers" | "private")
              }
              className={`p-3 rounded-[var(--radius-sm)] border text-left transition-colors ${
                v.disabled
                  ? "opacity-50 cursor-not-allowed border-[var(--border)] bg-[var(--surface-muted)]"
                  : visibility === v.id
                    ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--border-subtle)]"
              }`}
            >
              <div className="font-semibold text-xs text-[var(--foreground)]">
                {v.title}
              </div>
              <div className="text-[11px] text-[var(--foreground-secondary)] mt-0.5 leading-snug">
                {v.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Category Selection */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Category (Optional)
        </label>
        <select
          value={selectedCategory}
          onChange={(e) => {
            setSelectedCategory(e.target.value);
            setSelectedInterestIds([]);
          }}
          className="w-full p-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] text-xs focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">None / General</option>
          {INTEREST_CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      {/* Topic Association */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
            Topic Tags ({selectedInterestIds.length} / 5)
          </label>
          <span className="text-[10px] text-[var(--foreground-muted)]">
            Used by transparent recommendation scorer
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)]">
          {filteredInterests.slice(0, 25).map((interest) => {
            const isSelected = selectedInterestIds.includes(interest.id);
            return (
              <button
                key={interest.id}
                type="button"
                onClick={() => toggleInterest(interest.id)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  isSelected
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)]"
                    : "bg-[var(--surface)] text-[var(--foreground-secondary)] border-[var(--border)] hover:border-[var(--foreground-muted)]"
                }`}
              >
                {interest.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI & Material Alteration Disclosure */}
      <AiDisclosureSelector
        status={aiDisclosureStatus}
        details={aiDisclosureDetails}
        onStatusChange={setAiDisclosureStatus}
        onDetailsChange={setAiDisclosureDetails}
        disabled={isPending}
      />

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border)]">
        <button
          type="button"
          disabled={isPending}
          onClick={() => handleSubmit("draft")}
          className="px-4 py-2 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)] disabled:opacity-50 transition-colors"
        >
          {isPending ? "..." : "Save Draft"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => handleSubmit("published")}
          className="px-5 py-2 text-xs font-semibold rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending ? "Publishing..." : "Publish Content"}
        </button>
      </div>
    </div>
  );
}
