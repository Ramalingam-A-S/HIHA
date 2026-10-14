"use client";

import React, { useState, useTransition, useMemo } from "react";
import {
  INTEREST_CATEGORIES,
  type InterestCategoryId,
} from "@/lib/validations/interests";
import {
  saveUserInterestsAction,
  createCustomInterestAction,
  resetUserInterestsToDefaultsAction,
} from "@/app/actions/interests";
import type { Interest, UserInterestWithDetails } from "@/lib/supabase/types";

interface InterestSelectorProps {
  initialCatalog: Interest[];
  initialPreferences: UserInterestWithDetails[];
}

interface PreferenceState {
  interestId: string;
  priority: number;
}

const PRIORITY_LABELS: Record<number, { label: string; desc: string }> = {
  1: { label: "1 (Low)", desc: "Occasional subtle updates" },
  2: { label: "2 (Standard)", desc: "Balanced regular mix" },
  3: { label: "3 (High)", desc: "High priority in discovery" },
  4: { label: "4 (Very High)", desc: "Frequent prominent features" },
  5: { label: "5 (Essential)", desc: "Maximum priority weighting" },
};

export function InterestSelector({
  initialCatalog,
  initialPreferences,
}: InterestSelectorProps) {
  const [catalog, setCatalog] = useState<Interest[]>(initialCatalog);
  const [preferences, setPreferences] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const p of initialPreferences) {
      map.set(p.interest_id, p.priority);
    }
    return map;
  });

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Custom Interest Form State
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState<InterestCategoryId>(
    "technology-science"
  );
  const [customDescription, setCustomDescription] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  // Filtered Catalog
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      const matchesCategory =
        selectedCategory === "all" || item.category === selectedCategory;
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        query === "" ||
        item.name.toLowerCase().includes(query) ||
        (item.description && item.description.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [catalog, selectedCategory, searchQuery]);

  const toggleInterest = (interestId: string) => {
    setStatusMessage(null);
    setPreferences((prev) => {
      const next = new Map(prev);
      if (next.has(interestId)) {
        next.delete(interestId);
      } else {
        next.set(interestId, 2); // Default to Standard priority (2)
      }
      return next;
    });
  };

  const updatePriority = (interestId: string, priority: number) => {
    setStatusMessage(null);
    setPreferences((prev) => {
      const next = new Map(prev);
      next.set(interestId, priority);
      return next;
    });
  };

  const handleSave = () => {
    setStatusMessage(null);
    startTransition(async () => {
      const items: PreferenceState[] = Array.from(preferences.entries()).map(
        ([interestId, priority]) => ({ interestId, priority })
      );

      const result = await saveUserInterestsAction(items);
      if (result.success) {
        setStatusMessage({
          type: "success",
          text: result.message || "Interests and feed weights saved.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: result.message || "Failed to save preferences.",
        });
      }
    });
  };

  const handleReset = () => {
    if (!window.confirm("Reset all topic priorities to baseline defaults?")) {
      return;
    }
    setStatusMessage(null);
    startTransition(async () => {
      const result = await resetUserInterestsToDefaultsAction();
      if (result.success) {
        setPreferences(new Map());
        setStatusMessage({
          type: "success",
          text: result.message || "Preferences reset to baseline.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: result.message || "Failed to reset preferences.",
        });
      }
    });
  };

  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomError(null);

    startTransition(async () => {
      const result = await createCustomInterestAction({
        name: customName,
        category: customCategory,
        description: customDescription || undefined,
      });

      if (!result.success || !result.data) {
        setCustomError(result.message || "Failed to create custom interest.");
      } else {
        const created = result.data;
        setCatalog((prev) => [created, ...prev]);
        setPreferences((prev) => {
          const next = new Map(prev);
          next.set(created.id, 3); // Automatically select newly created custom interest
          return next;
        });
        setCustomName("");
        setCustomDescription("");
        setShowCustomModal(false);
        setStatusMessage({
          type: "success",
          text: `Custom topic '${created.name}' added to your catalog and selected.`,
        });
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Status Alert */}
      {statusMessage && (
        <div
          role="status"
          className={`p-4 text-xs rounded-[var(--radius-sm)] border ${
            statusMessage.type === "success"
              ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
              : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Top Search & Filter Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search topics (e.g., Robotics, Photography, Film)..."
            className="w-full px-3.5 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-2.5 text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowCustomModal(true)}
            className="py-2 px-3 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
          >
            + Create Custom Topic
          </button>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none" role="tablist">
        <button
          type="button"
          onClick={() => setSelectedCategory("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors ${
            selectedCategory === "all"
              ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
              : "bg-[var(--surface-muted)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
          }`}
        >
          All Topics ({catalog.length})
        </button>
        {INTEREST_CATEGORIES.map((cat) => {
          const count = catalog.filter((i) => i.category === cat.id).length;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors ${
                selectedCategory === cat.id
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "bg-[var(--surface-muted)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Interests Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredCatalog.map((item) => {
          const isSelected = preferences.has(item.id);
          const currentPriority = preferences.get(item.id) ?? 2;

          return (
            <div
              key={item.id}
              className={`p-4 rounded-[var(--radius-md)] border transition-all flex flex-col justify-between gap-3 ${
                isSelected
                  ? "border-[var(--accent)] bg-[var(--surface)] shadow-xs"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground-muted)]"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleInterest(item.id)}
                    className="text-left flex-1 focus:outline-none"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm text-[var(--foreground)] hover:underline">
                        {item.name}
                      </span>
                      {item.is_custom && (
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                          Custom
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-[var(--foreground-secondary)] mt-1 line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                    )}
                  </button>

                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleInterest(item.id)}
                    aria-label={`Select ${item.name}`}
                    className="mt-1 rounded border-[var(--border)] text-[var(--accent)] cursor-pointer"
                  />
                </div>
              </div>

              {/* Priority Slider / Selector if Selected */}
              {isSelected && (
                <div className="pt-2.5 border-t border-[var(--border-subtle)] space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--foreground-muted)]">Weight:</span>
                    <span className="font-mono font-medium text-[var(--accent)]">
                      {PRIORITY_LABELS[currentPriority]?.label}
                    </span>
                  </div>
                  <div className="flex gap-1" role="radiogroup" aria-label="Priority level">
                    {[1, 2, 3, 4, 5].map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => updatePriority(item.id, lvl)}
                        className={`flex-1 py-1 text-[10px] font-mono rounded-[var(--radius-sm)] border transition-colors ${
                          currentPriority === lvl
                            ? "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)] font-bold"
                            : "bg-[var(--surface-muted)] text-[var(--foreground-secondary)] border-[var(--border)] hover:bg-[var(--background)]"
                        }`}
                        title={PRIORITY_LABELS[lvl]?.desc}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredCatalog.length === 0 && (
        <div className="p-8 text-center rounded-[var(--radius-md)] border border-dashed border-[var(--border)] text-[var(--foreground-muted)] space-y-2">
          <p className="text-sm">No topics found matching &quot;{searchQuery}&quot;.</p>
          <button
            type="button"
            onClick={() => {
              setCustomName(searchQuery);
              setShowCustomModal(true);
            }}
            className="text-xs text-[var(--accent)] font-medium underline"
          >
            Create &quot;{searchQuery}&quot; as a custom topic
          </button>
        </div>
      )}

      {/* Sticky Save & Action Dock */}
      <div className="sticky bottom-4 z-10 p-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-md flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-[var(--foreground)]">
            {preferences.size} selected topic{preferences.size === 1 ? "" : "s"}
          </span>
          <span className="text-[var(--foreground-muted)]">|</span>
          <span className="text-[var(--foreground-secondary)]">
            Changes apply to your personalized feeds
          </span>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            disabled={isPending || preferences.size === 0}
            onClick={handleReset}
            className="flex-1 sm:flex-initial py-2 px-3 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-secondary)] hover:text-[var(--foreground)] disabled:opacity-50 transition-colors"
          >
            Reset Defaults
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className="flex-1 sm:flex-initial py-2 px-5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPending ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>

      {/* Create Custom Topic Modal */}
      {showCustomModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md p-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                Create Custom Topic
              </h2>
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            </div>

            {customError && (
              <div
                role="alert"
                className="p-3 text-xs rounded-[var(--radius-sm)] border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
              >
                {customError}
              </div>
            )}

            <form onSubmit={handleCreateCustom} className="space-y-4">
              <div className="space-y-1">
                <label
                  htmlFor="custom-name"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Topic Name
                </label>
                <input
                  id="custom-name"
                  type="text"
                  required
                  maxLength={60}
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g., Quantum Computing or Permaculture"
                  className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="custom-category"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Domain Category
                </label>
                <select
                  id="custom-category"
                  value={customCategory}
                  onChange={(e) =>
                    setCustomCategory(e.target.value as InterestCategoryId)
                  }
                  className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)]"
                >
                  {INTEREST_CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="custom-description"
                  className="block text-xs font-medium text-[var(--foreground)]"
                >
                  Brief Description (Optional)
                </label>
                <textarea
                  id="custom-description"
                  rows={2}
                  maxLength={250}
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="Explain what content fits into this topic..."
                  className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:border-[var(--accent)] resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="py-2 px-3 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-secondary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="py-2 px-4 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
                >
                  {isPending ? "Creating..." : "Add to Catalog"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
