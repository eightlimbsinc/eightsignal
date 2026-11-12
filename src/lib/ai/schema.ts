import { z } from "zod";
import { DEPARTMENTS, IMPACT_LEVELS } from "@/lib/intel/taxonomy";

/**
 * Shape requested from Claude via structured outputs. Kept free of numeric/length
 * constraints (not all JSON Schema keywords are supported by structured outputs);
 * business rules are enforced afterwards in `validateAnalysis`.
 */
export const AnalysisOutputSchema = z.object({
  summary: z.string().describe("One or two sentence executive summary."),
  what_happened: z.string(),
  why_it_matters: z.string(),
  who_is_affected: z.object({
    teams: z.array(z.string()).describe("Teams, roles or services affected."),
    departments: z.array(z.enum(DEPARTMENTS)),
  }),
  affected_clients: z
    .array(
      z.object({
        client_name: z.string().describe("Exact name from the provided client registry."),
        reason: z.string(),
        recommended_action: z.string(),
      }),
    )
    .describe("Only clients from the registry with a concrete, stack-based reason. Empty if none."),
  risk_assessment: z.string(),
  opportunity_assessment: z.string(),
  recommended_actions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      department: z.enum(DEPARTMENTS),
      priority: z.enum(["critical", "high", "medium", "low"]),
    }),
  ),
  impact_level: z.enum(IMPACT_LEVELS),
  confidence_score: z.number().describe("0.0 to 1.0"),
  confidence_rationale: z.string().describe("Explain any uncertainty."),
  source_classification: z.enum([
    "verified_announcement",
    "official_documentation",
    "commentary",
    "speculation",
    "prediction",
    "unknown",
  ]),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export interface ValidatedAnalysis extends AnalysisOutput {
  rejected_clients: string[];
}

/** Applies business rules the JSON schema cannot express. Throws on unusable output. */
export function validateAnalysis(raw: unknown, knownClientNames: string[]): ValidatedAnalysis {
  const parsed = AnalysisOutputSchema.parse(raw);
  const nonEmpty = (s: string, field: string) => {
    if (!s || !s.trim()) throw new Error(`Analysis field "${field}" is empty`);
    return s.trim();
  };
  const known = new Map(knownClientNames.map((n) => [n.toLowerCase(), n]));
  const affected: AnalysisOutput["affected_clients"] = [];
  const rejected: string[] = [];
  for (const c of parsed.affected_clients) {
    const match = known.get(c.client_name.trim().toLowerCase());
    if (match) affected.push({ ...c, client_name: match });
    else rejected.push(c.client_name);
  }
  const score = Number.isFinite(parsed.confidence_score) ? parsed.confidence_score : 0;
  return {
    ...parsed,
    summary: nonEmpty(parsed.summary, "summary"),
    what_happened: nonEmpty(parsed.what_happened, "what_happened"),
    why_it_matters: nonEmpty(parsed.why_it_matters, "why_it_matters"),
    risk_assessment: nonEmpty(parsed.risk_assessment, "risk_assessment"),
    opportunity_assessment: nonEmpty(parsed.opportunity_assessment, "opportunity_assessment"),
    confidence_rationale: nonEmpty(parsed.confidence_rationale, "confidence_rationale"),
    confidence_score: Math.min(1, Math.max(0, score > 1 && score <= 100 ? score / 100 : score)),
    who_is_affected: {
      teams: [...new Set(parsed.who_is_affected.teams.map((t) => t.trim()).filter(Boolean))].slice(0, 15),
      departments: [...new Set(parsed.who_is_affected.departments)],
    },
    recommended_actions: parsed.recommended_actions
      .filter((a) => a.title.trim())
      .slice(0, 10),
    affected_clients: affected,
    rejected_clients: rejected,
  };
}
