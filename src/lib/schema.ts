import { z } from "zod";

export const AnalysisSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string().min(3),
        evidence: z.string().min(3),
      })
    )
    .length(3),
  risks: z
    .array(
      z.object({
        title: z.string().min(3),
        why: z.string().min(3),
      })
    )
    .length(2),
  action: z.object({
    title: z.string().min(3),
    rationale: z.string().min(3),
  }),
});

export type Analysis = z.infer<typeof AnalysisSchema>;
