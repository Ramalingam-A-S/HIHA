/**
 * Deterministic Content Recommendation Scorer
 *
 * Provides explainable, rule-based relevance scoring for candidate content
 * based on user-chosen interest taxonomy weights.
 *
 * Tenets:
 * 1. Deterministic: Identical inputs always yield the identical score and explanations.
 * 2. Transparent: Every scored candidate returns explicit reasons for why it ranked.
 * 3. Safety Separation: Content safety eligibility is enforced as an independent gate,
 *    never confounded with relevance scoring.
 * 4. Zero Opaque Engagement Loops: No behavioral tracking, clickbait rewards, or covert models.
 */

export interface ContentCandidate {
  id: string;
  title: string;
  primaryCategory: string;
  interestSlugs: string[];
  isSafetyEligible: boolean;
  safetyFlags?: string[];
}

export interface UserInterestPreference {
  slug: string;
  category: string;
  priority: number; // 1 (Low) to 5 (Essential)
}

export type FeedMode = "my-mix" | "focus" | "explore" | "quiet" | "following";

export interface ScorerOptions {
  mode?: FeedMode;
  explorationFactor?: number; // 0.0 to 1.0 (default: 0.15)
}

export interface RecommendationScore {
  candidateId: string;
  score: number;
  eligible: boolean;
  isExploration: boolean;
  matchedInterests: string[];
  matchedCategories: string[];
  reasons: string[];
}

export const MAX_EVALUATED_INTERESTS_PER_POST = 5;

const CATEGORY_PRIORITY_BOOSTS_FOCUS: Record<string, number> = {
  "technology-science": 1.25,
  "education-learning": 1.3,
  "business-careers": 1.15,
};

const CATEGORY_DAMPENERS_FOCUS: Record<string, number> = {
  "entertainment-gaming": 0.7,
  "personal-stories-lifestyle": 0.75,
};

/**
 * Computes deterministic relevance score and explainability breakdown for a candidate.
 */
export function scoreCandidate(
  candidate: ContentCandidate,
  userPreferences: UserInterestPreference[],
  options: ScorerOptions = {}
): RecommendationScore {
  const mode = options.mode ?? "my-mix";
  const explorationFactor = Math.min(Math.max(options.explorationFactor ?? 0.15, 0), 1);

  // 1. Safety Filter Gate (Strict Separation)
  if (!candidate.isSafetyEligible) {
    return {
      candidateId: candidate.id,
      score: 0,
      eligible: false,
      isExploration: false,
      matchedInterests: [],
      matchedCategories: [],
      reasons: [
        "Ineligible: Content did not meet platform safety and integrity standards.",
        ...(candidate.safetyFlags ?? []).map((f) => `Safety flag: ${f}`),
      ],
    };
  }

  // 2. Cold Start: User has no configured preferences
  if (userPreferences.length === 0) {
    return {
      candidateId: candidate.id,
      score: 10,
      eligible: true,
      isExploration: true,
      matchedInterests: [],
      matchedCategories: [],
      reasons: [
        "Exploration: Neutral baseline score for new account with no selected interests.",
      ],
    };
  }

  const preferenceMap = new Map<string, UserInterestPreference>();
  const userCategorySet = new Set<string>();

  for (const pref of userPreferences) {
    preferenceMap.set(pref.slug, pref);
    userCategorySet.add(pref.category);
  }

  let rawScore = 0;
  const matchedInterests: string[] = [];
  const matchedCategories: string[] = [];
  const reasons: string[] = [];

  // Anti-manipulation safeguard: deduplicate and cap evaluated tags per candidate
  const uniqueSlugs = Array.from(new Set(candidate.interestSlugs));
  const evaluatedSlugs = uniqueSlugs.slice(0, MAX_EVALUATED_INTERESTS_PER_POST);
  if (candidate.interestSlugs.length > evaluatedSlugs.length) {
    reasons.push(
      `Tag-stuffing safeguard: evaluated ${evaluatedSlugs.length} unique interest tag(s) up to the ${MAX_EVALUATED_INTERESTS_PER_POST}-tag maximum`
    );
  }

  // 3. Primary Interest Matching (Priority weight 1-5 yields 10-50 pts per match)
  for (const slug of evaluatedSlugs) {
    const pref = preferenceMap.get(slug);
    if (pref) {
      const matchPoints = pref.priority * 10;
      rawScore += matchPoints;
      matchedInterests.push(slug);
      reasons.push(
        `Direct match on selected interest '${slug}' (Priority weight: ${pref.priority}/5)`
      );
    }
  }

  // 4. Category Affinity Bonus
  if (userCategorySet.has(candidate.primaryCategory)) {
    const categoryCount = userPreferences.filter(
      (p) => p.category === candidate.primaryCategory
    ).length;
    // Category bonus: 4 pts per preference in category, capped at 12
    const categoryBonus = Math.min(categoryCount * 4, 12);
    rawScore += categoryBonus;
    matchedCategories.push(candidate.primaryCategory);
    reasons.push(
      `Category synergy with '${candidate.primaryCategory}' (${categoryBonus} pts from ${categoryCount} selected topic[s])`
    );
  }

  // 5. Exploration & Novelty Handling (When no direct interest matched)
  let isExploration = false;
  if (matchedInterests.length === 0) {
    isExploration = true;
    const baseExploration = Number((explorationFactor * 20).toFixed(2));
    rawScore += baseExploration;
    reasons.push(
      `Exploration baseline: Novel topic presented for perspective diversity (+${baseExploration} pts)`
    );
  }

  // 6. Mode-Specific Deterministic Modifiers
  let finalScore = rawScore;

  if (mode === "focus") {
    const boost = CATEGORY_PRIORITY_BOOSTS_FOCUS[candidate.primaryCategory];
    const dampener = CATEGORY_DAMPENERS_FOCUS[candidate.primaryCategory];
    if (boost) {
      finalScore = Number((finalScore * boost).toFixed(2));
      reasons.push(`Focus mode: ${Math.round((boost - 1) * 100)}% boost for learning-oriented domain`);
    } else if (dampener) {
      finalScore = Number((finalScore * dampener).toFixed(2));
      reasons.push(`Focus mode: ${Math.round((1 - dampener) * 100)}% reduction for recreational category`);
    }
  } else if (mode === "explore") {
    // Explore mode flips emphasis: novel topics get amplified, familiar ones capped
    if (isExploration) {
      finalScore = Number((finalScore * 2.5).toFixed(2));
      reasons.push("Explore mode: 150% bonus to promote novel perspectives outside your bubble");
    } else {
      finalScore = Number((Math.min(finalScore, 40)).toFixed(2));
      reasons.push("Explore mode: Capped familiar topic score to prioritize unfamiliar ideas");
    }
  } else if (mode === "quiet") {
    // Quiet mode: purely evaluates direct interest priority without extra category/synergy bonuses
    finalScore = matchedInterests.reduce((acc, slug) => {
      const pref = preferenceMap.get(slug);
      return acc + (pref ? pref.priority * 10 : 0);
    }, 0);
    if (finalScore === 0) finalScore = 5;
    reasons.splice(0, reasons.length);
    reasons.push("Quiet mode: Minimalist baseline calculated strictly on your selected priorities");
  }

  return {
    candidateId: candidate.id,
    score: Math.max(0, finalScore),
    eligible: true,
    isExploration,
    matchedInterests,
    matchedCategories,
    reasons,
  };
}
