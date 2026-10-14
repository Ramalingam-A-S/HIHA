import { z } from "zod";

export const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;

export const signUpSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Please provide a valid email address")
    .toLowerCase(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be at most 100 characters"),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      usernameRegex,
      "Username must only contain letters, numbers, and underscores"
    )
    .toLowerCase(),
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(60, "Display name must be at most 60 characters"),
  minimumAgeAttested: z
    .boolean()
    .default(true)
    .refine((val) => val === true, {
      message:
        "You must confirm that you meet the minimum age requirement (13+) to create an account.",
    }),
  ageSafetyMode: z
    .enum(["standard", "teen_13_17"])
    .default("standard"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Please provide a valid email address")
    .toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export const resetPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Please provide a valid email address")
    .toLowerCase(),
});

export type SignUpInput = z.input<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
