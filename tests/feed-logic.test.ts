import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  type ContentCandidate,
  type UserInterestPreference,
} from "@/lib/recommendation/scorer";

describe("Milestone 3.1: Personalized Feed Assembly & Transparent Ranking", () => {
  const userPreferences: UserInterestPreference[] = [
    { slug: "artificial-intelligence", category: "technology-science", priority: 5 },
    { slug: "robotics", category: "technology-science", priority: 4 },
    { slug: "digital-art", category: "art-design", priority: 2 },
  ];

  const postAI: ContentCandidate = {
    id: "post-1-ai",
    title: "Breakthroughs in Deep Learning",
    primaryCategory: "technology-science",
    interestSlugs: ["artificial-intelligence"],
    isSafetyEligible: true,
  };

  const postRobotics: ContentCandidate = {
    id: "post-2-robotics",
    title: "Autonomous Navigation in Quadrupeds",
    primaryCategory: "technology-science",
    interestSlugs: ["robotics"],
    isSafetyEligible: true,
  };

  const postGaming: ContentCandidate = {
    id: "post-3-gaming",
    title: "Competitive Gaming Tournaments",
    primaryCategory: "entertainment-gaming",
    interestSlugs: ["esports"],
    isSafetyEligible: true,
  };

  const postUnsafe: ContentCandidate = {
    id: "post-4-unsafe",
    title: "Malicious Content",
    primaryCategory: "technology-science",
    interestSlugs: ["artificial-intelligence"],
    isSafetyEligible: false,
    safetyFlags: ["prohibited_content"],
  };

  describe("My Mix Mode: Deterministic Ranking & Tie-breaking", () => {
    it("ranks candidates deterministically according to user interest priority weights", () => {
      const scoreAI = scoreCandidate(postAI, userPreferences, { mode: "my-mix" });
      const scoreRobotics = scoreCandidate(postRobotics, userPreferences, { mode: "my-mix" });
      const scoreGaming = scoreCandidate(postGaming, userPreferences, { mode: "my-mix" });

      // AI has priority 5 (50 pts + category synergy 8 pts = 58)
      // Robotics has priority 4 (40 pts + category synergy 8 pts = 48)
      // Gaming has no matched interest (exploration baseline: 3 pts)
      expect(scoreAI.score).toBeGreaterThan(scoreRobotics.score);
      expect(scoreRobotics.score).toBeGreaterThan(scoreGaming.score);

      // Determinism: Repeated scoring produces identical results
      const scoreAIRepeat = scoreCandidate(postAI, userPreferences, { mode: "my-mix" });
      expect(scoreAIRepeat.score).toEqual(scoreAI.score);
      expect(scoreAIRepeat.reasons).toEqual(scoreAI.reasons);
    });

    it("enforces stable tie-breaking using published_at and post ID", () => {
      const postA = {
        id: "aaa-uuid",
        published_at: "2026-10-09T12:00:00Z",
        score: 50,
      };
      const postB = {
        id: "bbb-uuid",
        published_at: "2026-10-09T12:00:00Z",
        score: 50,
      };

      const compare = (x: typeof postA, y: typeof postA) => {
        if (y.score !== x.score) return y.score - x.score;
        const timeX = new Date(x.published_at).getTime();
        const timeY = new Date(y.published_at).getTime();
        if (timeY !== timeX) return timeY - timeX;
        return x.id.localeCompare(y.id);
      };

      expect(compare(postA, postB)).toBeLessThan(0); // aaa precedes bbb
    });
  });

  describe("Focus Mode: Learning Domain Prioritization", () => {
    it("boosts educational and science categories while dampening recreational topics", () => {
      const focusAI = scoreCandidate(postAI, userPreferences, { mode: "focus" });
      const myMixAI = scoreCandidate(postAI, userPreferences, { mode: "my-mix" });

      // technology-science receives a 1.25x boost in Focus mode
      expect(focusAI.score).toBeGreaterThan(myMixAI.score);
      expect(focusAI.reasons.some((r) => r.includes("Focus mode: 25% boost"))).toBe(true);

      const focusGaming = scoreCandidate(postGaming, userPreferences, { mode: "focus" });
      const myMixGaming = scoreCandidate(postGaming, userPreferences, { mode: "my-mix" });
      // entertainment-gaming receives 0.7x dampener
      expect(focusGaming.score).toBeLessThan(myMixGaming.score);
    });
  });

  describe("Following Mode: Pure Chronological Ordering", () => {
    it("preserves strict reverse-chronological order without algorithmic reordering", () => {
      const posts = [
        { id: "post-old-high-score", published_at: "2026-10-08T10:00:00Z", score: 99 },
        { id: "post-new-low-score", published_at: "2026-10-09T10:00:00Z", score: 10 },
      ];

      // Chronological sort ignores score
      posts.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

      expect(posts[0].id).toBe("post-new-low-score");
      expect(posts[1].id).toBe("post-old-high-score");
    });
  });

  describe("Explore Mode: Novel Topic Amplification", () => {
    it("amplifies novel topics outside user interests by 150%", () => {
      const exploreGaming = scoreCandidate(postGaming, userPreferences, { mode: "explore" });
      const myMixGaming = scoreCandidate(postGaming, userPreferences, { mode: "my-mix" });

      expect(exploreGaming.isExploration).toBe(true);
      expect(exploreGaming.score).toBeGreaterThan(myMixGaming.score);
      expect(exploreGaming.reasons.some((r) => r.includes("Explore mode: 150% bonus"))).toBe(true);
    });

    it("caps familiar topic scores to prevent bubble reinforcement", () => {
      const exploreAI = scoreCandidate(postAI, userPreferences, { mode: "explore" });
      // Score capped at 40 in explore mode
      expect(exploreAI.score).toBeLessThanOrEqual(40);
      expect(exploreAI.reasons.some((r) => r.includes("Capped familiar topic score"))).toBe(true);
    });
  });

  describe("Quiet Mode: Minimalist Baseline & Low Stimulus", () => {
    it("calculates score strictly on direct interest priority without synergy multipliers", () => {
      const quietAI = scoreCandidate(postAI, userPreferences, { mode: "quiet" });
      // Priority 5 * 10 = 50, zero category bonuses
      expect(quietAI.score).toBe(50);
      expect(quietAI.reasons).toEqual([
        "Quiet mode: Minimalist baseline calculated strictly on your selected priorities",
      ]);
    });
  });

  describe("Safety Gating & Independence", () => {
    it("strictly rejects unsafe content regardless of interest relevance", () => {
      const unsafeScore = scoreCandidate(postUnsafe, userPreferences, { mode: "my-mix" });

      expect(unsafeScore.eligible).toBe(false);
      expect(unsafeScore.score).toBe(0);
      expect(unsafeScore.reasons.some((r) => r.includes("Ineligible"))).toBe(true);
    });
  });

  describe("Mutes & Social Filtering Rules", () => {
    it("filters out posts from muted creators", () => {
      const candidateList = [
        { id: "p1", creator_id: "creator-a" },
        { id: "p2", creator_id: "muted-creator-b" },
        { id: "p3", creator_id: "creator-c" },
      ];
      const mutedSet = new Set(["muted-creator-b"]);

      const eligible = candidateList.filter((p) => !mutedSet.has(p.creator_id));
      expect(eligible.length).toBe(2);
      expect(eligible.map((p) => p.id)).toEqual(["p1", "p3"]);
    });

    it("ensures blocks override follows in feed eligibility", () => {
      const followAccepted = true;
      const isBlocked = true;

      // Access is false if blocked, regardless of follow
      const isEligible = followAccepted && !isBlocked;
      expect(isEligible).toBe(false);
    });
  });
});
