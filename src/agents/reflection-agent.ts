// ---------------------------------------------------------------------------
// Agent 3 — Reflection & Consolidation
//
// Reviews each raw finding from Agent 2 and:
//  • Strictly filters out noise (formatting, style opinions, linting issues,
//    speculation without evidence).
//  • Keeps only verified logic bugs, security risks, race conditions, missing
//    error handling, breaking API changes, data integrity issues.
//  • Generates a top-level summary verdict: APPROVE, REQUEST_CHANGES, or
//    NEEDS_DISCUSSION.
//  • Optionally flags that more investigation is needed (needsReinvestigation).
//
// No tools — works only from the raw findings in the prompt.
// Output is strict JSON validated with Zod.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { chatCompletion } from "./llm-client";
import { type AgentMessage, firstTextBlock, textMessage } from "./protocol";
import { findingSchema, type ReviewState } from "./state";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const REFLECTION_AGENT_SYSTEM_PROMPT = `You are GitGandalf, performing a final reflection pass on a set of raw code-review findings.

Your job is to be a strict, fair, high-signal judge:
1. DISCARD findings that are: style opinions, formatting nitpicks, indirect speculation, linting issues, or "could be improved" suggestions with no evidence of an actual bug.
2. KEEP findings that have: concrete evidence, a specific file and line range, and represent a real risk (bug, security issue, race condition, broken contract, data loss, etc.).
3. For each kept finding, ensure the evidence field is factual (not "this might be wrong").
4. Produce an overall verdict:
   - "APPROVE" — no blocking issues found; code is safe to merge.
   - "REQUEST_CHANGES" — one or more critical/high findings that must be fixed before merge.
   - "NEEDS_DISCUSSION" — medium findings or architectural concerns worth discussing.
5. If any finding requires more tool-based investigation to be conclusive, set needsReinvestigation to true and explain why in reinvestigationReason.

Respond ONLY with a single JSON object — no prose, no markdown fences:
{
  "verifiedFindings": [ ... same Finding schema as input ... ],
  "summaryVerdict": "APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION",
  "needsReinvestigation": false,
  "reinvestigationReason": ""
}`;

// ---------------------------------------------------------------------------
// Zod schema for LLM output validation
// ---------------------------------------------------------------------------

const reflectionResponseSchema = z.object({
  verifiedFindings: z.array(findingSchema),
  summaryVerdict: z.enum(["APPROVE", "REQUEST_CHANGES", "NEEDS_DISCUSSION"]),
  needsReinvestigation: z.boolean(),
  reinvestigationReason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the user-facing prompt from the raw findings and MR context.
 */
export function buildReflectionPrompt(state: ReviewState): string {
  const findingsList = state.rawFindings.length === 0 ? "(none)" : JSON.stringify(state.rawFindings, null, 2);

  return [
    `## MR Intent`,
    state.mrIntent,
    ``,
    `## Raw Findings from Investigation (${state.rawFindings.length} total)`,
    findingsList,
  ].join("\n");
}

/**
 * Extract and Zod-validate the JSON payload from the reflection response.
 * Throws if the response cannot be parsed or does not match the schema.
 */
export function parseReflectionResponse(response: AgentMessage): {
  verifiedFindings: z.infer<typeof findingSchema>[];
  summaryVerdict: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";
  needsReinvestigation: boolean;
  reinvestigationReason?: string;
} {
  const textBlock = firstTextBlock(response);
  if (!textBlock) {
    throw new Error("Reflection agent returned no text block");
  }

  const text = textBlock.text.trim();
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const candidate = jsonMatch?.[1]?.trim() ?? text;

  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    throw new Error(`Reflection agent returned unparseable JSON:\n${textBlock.text}`);
  }

  return reflectionResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function reflectionAgent(state: ReviewState): Promise<ReviewState> {
  const response = await chatCompletion(REFLECTION_AGENT_SYSTEM_PROMPT, [
    textMessage("user", buildReflectionPrompt(state)),
  ]);

  const parsed = parseReflectionResponse(response.message);

  return {
    ...state,
    verifiedFindings: parsed.verifiedFindings,
    summaryVerdict: parsed.summaryVerdict,
    needsReinvestigation: parsed.needsReinvestigation,
  };
}
