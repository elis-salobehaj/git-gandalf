// ---------------------------------------------------------------------------
// Agent 1 — Context & Intent Mapper
//
// Analyses the MR title, description, and diff to determine:
//  • mrIntent          — what the developer is trying to achieve
//  • changeCategories  — areas of the codebase affected (auth, API, DB…)
//  • riskAreas         — hypotheses for Agent 2 to investigate
//
// No tools — works only from the data passed in the prompt.
// Output is strict JSON validated with Zod at the external boundary.
// ---------------------------------------------------------------------------

import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { chatCompletion } from "./llm-client";
import type { ReviewState } from "./state";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const CONTEXT_AGENT_SYSTEM_PROMPT = `You are GitGandalf, an expert code-review AI.
Your task is to analyse a GitLab Merge Request and produce a structured summary.

You will be given the MR title, description, and the raw git diff.

Respond ONLY with a single JSON object — no prose, no markdown fences — in this exact shape:
{
  "intent": "<one sentence describing what the developer is trying to achieve>",
  "categories": ["<area1>", "<area2>"],
  "riskHypotheses": ["<hypothesis1>", "<hypothesis2>"]
}

Guidelines:
- "intent" must be a single declarative sentence.
- "categories" should name high-level concern areas: e.g. "authentication", "database", "API layer", "configuration", "UI", "dependencies".
- "riskHypotheses" are specific, testable questions for investigation, e.g.
    "The DB schema changed — check whether all DTOs and migration scripts are updated."
    "A public API signature changed — verify all callers are updated."
- Limit to the 5 most important hypotheses. Return [] if the change is trivial.`;

// ---------------------------------------------------------------------------
// Zod schema for LLM output validation
// ---------------------------------------------------------------------------

const contextResponseSchema = z.object({
  intent: z.string().min(1),
  categories: z.array(z.string()),
  riskHypotheses: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the user-facing prompt from the current review state.
 * Caps the diff at 8000 characters to stay within token budgets.
 */
export function buildContextPrompt(state: ReviewState): string {
  const MAX_DIFF_CHARS = 8_000;

  const diffSummary = state.diffFiles
    .map((f) => {
      const header = `--- ${f.oldPath}\n+++ ${f.newPath}`;
      return `${header}\n${f.diff}`;
    })
    .join("\n\n")
    .slice(0, MAX_DIFF_CHARS);

  return [
    `## Merge Request`,
    `**Title**: ${state.mrDetails.title}`,
    `**Description**: ${state.mrDetails.description ?? "(none)"}`,
    `**Author**: ${state.mrDetails.authorUsername}`,
    `**Source branch**: ${state.mrDetails.sourceBranch} → ${state.mrDetails.targetBranch}`,
    `**Files changed**: ${state.diffFiles.length}`,
    ``,
    `## Diff`,
    diffSummary,
  ].join("\n");
}

/**
 * Extract and Zod-validate the JSON payload from the LLM response.
 * Throws if the response cannot be parsed or does not match the schema.
 */
export function parseContextResponse(response: Message): {
  intent: string;
  categories: string[];
  riskHypotheses: string[];
} {
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Context agent returned no text block");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(textBlock.text.trim());
  } catch {
    throw new Error(`Context agent returned unparseable JSON:\n${textBlock.text}`);
  }

  return contextResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function contextAgent(state: ReviewState): Promise<ReviewState> {
  const response = await chatCompletion(CONTEXT_AGENT_SYSTEM_PROMPT, [
    { role: "user", content: buildContextPrompt(state) },
  ]);

  const parsed = parseContextResponse(response);

  return {
    ...state,
    mrIntent: parsed.intent,
    changeCategories: parsed.categories,
    riskAreas: parsed.riskHypotheses,
  };
}
