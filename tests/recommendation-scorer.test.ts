import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  type ContentCandidate,
  type UserInterestPreference,
} from "@/lib/recommendation/scorer";

describe("Deterministic Recommendation Scorer", () => {
  const sampleCandidate: ContentCandidate = {
    id: "content-101",
    title: "Understanding Autonomous Quadruped Robotics",
    primaryCategory: "technology-science",
    interestSlugs: ["robotics-automation", "artificial-intelligence"],
    isSafetyEligible: true,
  };

  const samplePreferences: UserInterestPreference[] = [
    { slug: "robotics-automation", category: "technology-science", priority: 4 },
    { slug: "digital-art", category: "art-design", priority: 2 },
  ];

  it("produces identical deterministic scores for identical inputs", () => {
    const score1 = scoreCandidate(sampleCandidate, samplePreferences);
    const score2 = scoreCandidate(sampleCandidate, samplePreferences);

    expect(score1).toEqual(score2);
    expect(score1.score).toBe(score2.score);
  });

  it("calculates direct interest matches weighted by user priority", () => {
    const result = scoreCandidate(sampleCandidate, samplePreferences);

    // Matches 'robotics-automation' (priority 4 -> 40 pts)
    // Category synergy for 'technology-science' (1 preference -> +4 pts)
    // Expected raw score = 40 + 4 = 44
    expect(result.score).toBe(44);
    expect(result.eligible).toBe(true);
    expect(result.isExploration).toBe(false);
    expect(result.matchedInterests).toContain("robotics-automation");
    expect(result.matchedCategories).toContain("technology-science");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("strictly enforces the safety gate regardless of user interest affinity", () => {
    const unsafeCandidate: ContentCandidate = {
      ...sampleCandidate,
      isSafetyEligible: false,
      safetyFlags: ["spam_flag", "policy_review"],
    };

    const result = scoreCandidate(unsafeCandidate, samplePreferences);

    expect(result.eligible).toBe(false);
    expect(result.score).toBe(0);
    expect(result.matchedInterests).toEqual([]);
    expect(result.reasons[0]).toContain("Ineligible: Content did not meet platform safety");
    expect(result.reasons.some((r) => r.includes("Safety flag: spam_flag"))).toBe(true);
  });

  it("handles cold start for new users with a neutral exploration baseline", () => {
    const result = scoreCandidate(sampleCandidate, []);

    expect(result.eligible).toBe(true);
    expect(result.isExploration).toBe(true);
    expect(result.score).toBe(10);
    expect(result.reasons[0].toLowerCase()).toContain("neutral baseline score for new account");
  });

  it("provides deterministic exploration score for novel, unmatched topics", () => {
    const unrelatedCandidate: ContentCandidate = {
      id: "content-999",
      title: "History of Minoan Crete",
      primaryCategory: "education-learning",
      interestSlugs: ["history-archaeology"],
      isSafetyEligible: true,
    };

    const result = scoreCandidate(unrelatedCandidate, samplePreferences, {
      explorationFactor: 0.2,
    });

    expect(result.eligible).toBe(true);
    expect(result.isExploration).toBe(true);
    expect(result.score).toBe(4.0); // 0.2 * 20 = 4.0
    expect(result.matchedInterests).toHaveLength(0);
    expect(result.reasons[0]).toContain("Exploration baseline");
  });

  describe("Feed Mode Modifiers", () => {
    it("boosts education and science in focus mode", () => {
      const myMixScore = scoreCandidate(sampleCandidate, samplePreferences, {
        mode: "my-mix",
      });
      const focusScore = scoreCandidate(sampleCandidate, samplePreferences, {
        mode: "focus",
      });

      // Focus mode boosts technology-science by 25% (44 * 1.25 = 55)
      expect(focusScore.score).toBeGreaterThan(myMixScore.score);
      expect(focusScore.reasons.some((r) => r.includes("Focus mode"))).toBe(true);
    });

    it("dampens recreational categories in focus mode", () => {
      const gamingCandidate: ContentCandidate = {
        id: "game-1",
        title: "Speedrunning Mechanics",
        primaryCategory: "entertainment-gaming",
        interestSlugs: ["game-development"],
        isSafetyEligible: true,
      };

      const gamingPrefs: UserInterestPreference[] = [
        { slug: "game-development", category: "entertainment-gaming", priority: 3 },
      ];

      const myMixScore = scoreCandidate(gamingCandidate, gamingPrefs, {
        mode: "my-mix",
      });
      const focusScore = scoreCandidate(gamingCandidate, gamingPrefs, {
        mode: "focus",
      });

      expect(focusScore.score).toBeLessThan(myMixScore.score);
    });

    it("amplifies novelty and caps familiar topics in explore mode", () => {
      const novelCandidate: ContentCandidate = {
        id: "novel-1",
        title: "Ethical Permaculture Techniques",
        primaryCategory: "personal-stories-lifestyle",
        interestSlugs: ["diy-crafting"],
        isSafetyEligible: true,
      };

      const standardScore = scoreCandidate(novelCandidate, samplePreferences, {
        mode: "my-mix",
      });
      const exploreScore = scoreCandidate(novelCandidate, samplePreferences, {
        mode: "explore",
      });

      expect(exploreScore.score).toBeGreaterThan(standardScore.score);
      expect(exploreScore.reasons.some((r) => r.includes("Explore mode"))).toBe(true);
    });

    it("strips synergy bonuses in quiet mode to evaluate strictly on priority", () => {
      const result = scoreCandidate(sampleCandidate, samplePreferences, {
        mode: "quiet",
      });

      // Pure priority calculation: priority 4 * 10 = 40 (no category synergy bonus)
      expect(result.score).toBe(40);
      expect(result.reasons[0]).toContain("Quiet mode");
    });
  });
});
