import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { serverEnv } from "@/lib/env";
import { AnalysisOutputSchema, validateAnalysis, type ValidatedAnalysis } from "./schema";
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserMessage, type PromptClient, type PromptItem } from "./prompt";

export class AnalysisError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "AnalysisError";
  }
}

export interface AnalysisRun {
  analysis: ValidatedAnalysis;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const apiKey = serverEnv.anthropicApiKey();
  if (!apiKey) throw new AnalysisError("ANTHROPIC_API_KEY is not configured", false);
  client ??= new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  return client;
}

export function isAiConfigured(): boolean {
  return Boolean(serverEnv.anthropicApiKey());
}

/** Runs the structured impact analysis for one record. Server-side only. */
export async function analyzeIntelligence(item: PromptItem, clients: PromptClient[]): Promise<AnalysisRun> {
  const anthropic = getClient();
  const model = serverEnv.anthropicModel();
  try {
    const response = await anthropic.beta.messages.parse({
      model,
      max_tokens: 16_000,
      // Server-side refusal fallback: if the primary model declines, the API reruns on a fallback.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: serverEnv.anthropicEffort(),
        format: betaZodOutputFormat(AnalysisOutputSchema),
      },
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildAnalysisUserMessage(item, clients) }],
    });

    if (response.stop_reason === "refusal") {
      throw new AnalysisError("The model declined to analyse this content.", false);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AnalysisError("Analysis was truncated (max_tokens reached).", true);
    }
    if (!response.parsed_output) {
      throw new AnalysisError("The model response did not match the analysis schema.", true);
    }
    const analysis = validateAnalysis(response.parsed_output, clients.map((c) => c.name));
    return {
      analysis,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (e) {
    if (e instanceof AnalysisError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new AnalysisError("Claude API rate limit reached; try again shortly.", true);
    if (e instanceof Anthropic.AuthenticationError) throw new AnalysisError("Claude API authentication failed; check ANTHROPIC_API_KEY.", false);
    if (e instanceof Anthropic.BadRequestError) throw new AnalysisError(`Claude API rejected the request: ${e.message}`, false);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AnalysisError("Claude API request timed out.", true);
    if (e instanceof Anthropic.APIError) throw new AnalysisError(`Claude API error: ${e.message}`, true);
    throw new AnalysisError(e instanceof Error ? e.message : "Unknown analysis error", false);
  }
}
