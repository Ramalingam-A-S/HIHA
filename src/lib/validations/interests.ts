import { z } from "zod";

export const INTEREST_CATEGORIES = [
  { id: "technology-science", label: "Technology & Science" },
  { id: "education-learning", label: "Education & Learning" },
  { id: "art-design", label: "Art & Design" },
  { id: "sports-fitness", label: "Sports & Fitness" },
  { id: "entertainment-gaming", label: "Entertainment & Gaming" },
  { id: "personal-stories-lifestyle", label: "Personal Stories & Lifestyle" },
  { id: "social-causes-community", label: "Social Causes & Community" },
  { id: "business-careers", label: "Business & Careers" },
  { id: "health-wellbeing", label: "Health & Well-being" },
] as const;

export const categoryIds = INTEREST_CATEGORIES.map((c) => c.id);
export type InterestCategoryId = (typeof categoryIds)[number];

export const interestCategoryEnum = z.enum([
  "technology-science",
  "education-learning",
  "art-design",
  "sports-fitness",
  "entertainment-gaming",
  "personal-stories-lifestyle",
  "social-causes-community",
  "business-careers",
  "health-wellbeing",
]);

/**
 * Normalizes custom interest name into a database-compliant slug (2-60 chars, lowercase, hyphens/numbers).
 */
export function slugifyInterest(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const customInterestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name cannot exceed 60 characters"),
  category: interestCategoryEnum,
  description: z
    .string()
    .trim()
    .max(250, "Description cannot exceed 250 characters")
    .optional()
    .nullable()
    .transform((val) => (val === "" ? null : val)),
});

export const userInterestItemSchema = z.object({
  interestId: z.string().uuid("Invalid interest ID"),
  priority: z
    .number()
    .int()
    .min(1, "Priority must be between 1 and 5")
    .max(5, "Priority must be between 1 and 5"),
});

export const saveUserInterestsSchema = z.object({
  interests: z.array(userInterestItemSchema).max(50, "Maximum of 50 interests allowed"),
});

export type CustomInterestInput = z.infer<typeof customInterestSchema>;
export type UserInterestItemInput = z.infer<typeof userInterestItemSchema>;
export type SaveUserInterestsInput = z.infer<typeof saveUserInterestsSchema>;
