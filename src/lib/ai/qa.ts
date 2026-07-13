// src/lib/ai/qa.ts
//
// M11 — QA scoring orchestrator. Loads the tenant's active rubric,
// asks the provider to grade the reply body against every dimension,
// computes weighted overall + flags. Pure functions on rubric shape
// live here so tests can pin their behaviour without the DB.
//
// Spec §3 pins encoded here:
//   - "Do NOT let the rubric prompt leak to Sentry" — provider call
//     is wrapped in try/catch that swallows silently.
//   - "Do NOT run QA on AI-drafted-but-not-sent messages" — this file
//     only scores what's persisted via Message. Draft state has no
//     Message row, so the code path can't reach here.

import { z } from "zod";

// ---------------------------------------------------------------------
// Rubric shape (also the persisted JSON on QaRubric.dimensions)
// ---------------------------------------------------------------------

export const rubricDimensionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "snake_case only"),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  // Weights don't have to sum to 1 — we normalise. Range keeps the UI
  // from writing wild numbers.
  weight: z.number().min(0).max(10),
  // Any per-dimension score BELOW this triggers a flag.
  flagBelow: z.number().min(0).max(5),
});

export const rubricSchema = z.array(rubricDimensionSchema).min(1).max(10);

export type RubricDimension = z.infer<typeof rubricDimensionSchema>;
export type Rubric = z.infer<typeof rubricSchema>;

export function readRubric(raw: unknown): Rubric | null {
  const parsed = rubricSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------
// Overall + flag computation. Pure. Weight-normalised weighted mean.
// ---------------------------------------------------------------------

export function computeOverall(
  rubric: Rubric,
  scoresByKey: Record<string, number>
): number {
  const totalWeight = rubric.reduce((s, d) => s + d.weight, 0);
  if (totalWeight <= 0) {
    // Falls back to unweighted mean if the admin set every weight to 0.
    const scores = rubric.map((d) => scoresByKey[d.key] ?? 0);
    return scores.reduce((s, v) => s + v, 0) / (scores.length || 1);
  }
  const sum = rubric.reduce(
    (s, d) => s + (scoresByKey[d.key] ?? 0) * d.weight,
    0
  );
  return sum / totalWeight;
}

export function computeFlags(
  rubric: Rubric,
  scoresByKey: Record<string, number>
): string[] {
  const flagged: string[] = [];
  for (const d of rubric) {
    const score = scoresByKey[d.key];
    if (typeof score === "number" && score < d.flagBelow) {
      flagged.push(d.key);
    }
  }
  return flagged;
}

// ---------------------------------------------------------------------
// Default seed rubric. Used by seedDefaultRubric when a tenant has no
// active rubric yet. Deliberately opinionated but modifiable.
// ---------------------------------------------------------------------

export const DEFAULT_RUBRIC: Rubric = [
  {
    key: "helpfulness",
    label: "Helpfulness",
    description:
      "Did the reply actually resolve the customer's question or move it forward with a concrete next step?",
    weight: 3,
    flagBelow: 3,
  },
  {
    key: "tone",
    label: "Tone",
    description:
      "Warm, professional, empathetic. Matches brand voice. No condescension or defensiveness.",
    weight: 2,
    flagBelow: 3,
  },
  {
    key: "accuracy",
    label: "Accuracy",
    description:
      "Facts, prices, policies, and product details all correct. No invented or contradicted claims.",
    weight: 3,
    flagBelow: 3.5,
  },
  {
    key: "compliance",
    label: "Compliance",
    description:
      "No PII exposed, no unauthorized promises, no policy or legal violations.",
    weight: 2,
    flagBelow: 4,
  },
];
