import { z } from "zod";

export const Confidence = z.enum(["High", "Medium", "Low"]);
export type Confidence = z.infer<typeof Confidence>;

const Insight = z.object({
  title: z.string().min(3).max(180),
  evidence: z.string().min(3).max(260),
  impact: z.string().min(3).max(220),
  confidence: Confidence,
});

const Risk = z.object({
  title: z.string().min(3).max(180),
  severity: Confidence,
  reason: z.string().min(3).max(260),
  confidence: Confidence,
});

const Recommendation = z.object({
  action: z.string().min(3).max(200),
  reasoning: z.string().min(3).max(280),
  priority: Confidence,
});

export const AnalysisSchema = z.object({
  summary: z.string().min(10).max(320),
  insights: z.array(Insight).length(3),
  risks: z.array(Risk).length(2),
  recommendation: Recommendation,
});

export type Analysis = z.infer<typeof AnalysisSchema>;
export type Insight = z.infer<typeof Insight>;
export type Risk = z.infer<typeof Risk>;
export type Recommendation = z.infer<typeof Recommendation>;
