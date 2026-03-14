// ---------------------------------------------------------------------------
// Agent 2 — Socratic Investigator
//
// Given the risk hypotheses from Agent 1, iteratively:
//  1. Forms a specific investigative question.
//  2. Uses tools (read_file, search_codebase, get_directory_structure) to find
//     evidence.
//  3. Records concrete findings: file, line range, risk level, evidence, fix.
//
// The tool loop runs until the LLM stops requesting tools (stop_reason ===
// "end_turn") or config.MAX_TOOL_ITERATIONS is reached.
//
// At end_turn, the agent emits a JSON array of findings in its final text block.
// ---------------------------------------------------------------------------

import type { ContentBlockParam, Message, MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { config } from "../config";
import { executeTool, TOOL_DEFINITIONS } from "../context/tools";
import { chatCompletion } from "./llm-client";
import { type Finding, findingSchema, type ReviewState } from "./state";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const INVESTIGATOR_SYSTEM_PROMPT = `You are GitGandalf, an expert code-review AI performing deep investigation.

You have access to tools that let you explore the repository:
- read_file: read a file's contents
- search_codebase: full-text regex search across the repo
- get_directory_structure: list the directory tree

**Your mission:**
For each risk hypothesis given to you, form a specific question and use your tools to find evidence.
Investigate thoroughly — look beyond the diff into related files, callers, dependants, and tests.

**When you are done investigating**, stop calling tools and output ONLY a JSON array of findings.
Each finding must match this schema EXACTLY (no markdown fences, no prose — just the raw array):
[
  {
    "file": "src/path/to/file.ts",
    "lineStart": 42,
    "lineEnd": 45,
    "riskLevel": "critical|high|medium|low",
    "title": "Short title of the issue",
    "description": "What is wrong and why it matters",
    "evidence": "Specific code or output from tools that proves the issue",
    "suggestedFix": "Optional: concrete suggestion"
  }
]

If you find no issues, output an empty array: []

Rules:
- Only report findings with concrete evidence from your tool calls. No speculation.
- Exclude formatting/style/linting issues — those are handled by CI.
- Focus on: logic bugs, security vulnerabilities, race conditions, missing error handling,
  breaking API changes, data integrity issues, missing tests for critical paths.`;

// ---------------------------------------------------------------------------
// Response-parsing schemas
// ---------------------------------------------------------------------------

const rawFindingsSchema = z.array(findingSchema);
const toolInputSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the initial investigator user prompt from context-agent output.
 */
export function buildInvestigatorPrompt(state: ReviewState): string {
  const MAX_DIFF_CHARS = 6_000;

  const diffSummary = state.diffFiles
    .map((f) => `--- ${f.oldPath}\n+++ ${f.newPath}\n${f.diff}`)
    .join("\n\n")
    .slice(0, MAX_DIFF_CHARS);

  const hypotheses = state.riskAreas.length
    ? state.riskAreas.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "(none — do a general review)";

  return [
    `## MR Intent`,
    state.mrIntent,
    ``,
    `## Change Categories`,
    state.changeCategories.join(", ") || "(general)",
    ``,
    `## Risk Hypotheses to Investigate`,
    hypotheses,
    ``,
    `## Diff (truncated to ${MAX_DIFF_CHARS} chars)`,
    diffSummary,
  ].join("\n");
}

/**
 * Extract the findings JSON array from the final assistant message.
 *
 * Looks for a JSON array in the last text block of the message history.
 * Returns [] if no valid findings are found (safe default).
 */
export function extractFindings(messages: MessageParam[]): Finding[] {
  // Walk assistant messages from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      if (!("type" in block) || block.type !== "text") continue;
      if (!("text" in block) || typeof block.text !== "string") continue;

      const text = block.text.trim();
      // Try to extract a JSON array — accept both raw JSON and ```json fenced blocks
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\[[\s\S]*\])/);
      if (!jsonMatch) continue;

      const candidate = jsonMatch[1]?.trim();
      if (!candidate) continue;

      try {
        const parsed = JSON.parse(candidate);
        const result = rawFindingsSchema.safeParse(parsed);
        if (result.success) return result.data;
      } catch {
        // Not valid JSON — try next block
      }
    }
  }
  return [];
}

/**
 * Convert Anthropic response blocks into the MessageParam content shapes we
 * persist in ReviewState. Rejects unexpected block types explicitly.
 */
export function normalizeAssistantContent(content: Message["content"]): ContentBlockParam[] {
  return content.map((block) => {
    if (block.type === "text") {
      return {
        type: "text",
        text: block.text,
      };
    }

    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: toolInputSchema.parse(block.input),
      };
    }

    throw new Error(`Unsupported assistant content block type: ${block.type}`);
  });
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function investigatorLoop(state: ReviewState): Promise<ReviewState> {
  const messages: MessageParam[] = [{ role: "user", content: buildInvestigatorPrompt(state) }];

  let iterations = 0;

  while (iterations < config.MAX_TOOL_ITERATIONS) {
    const response: Message = await chatCompletion(INVESTIGATOR_SYSTEM_PROMPT, messages, TOOL_DEFINITIONS);

    // Append the assistant turn to history
    messages.push({
      role: "assistant",
      content: normalizeAssistantContent(response.content),
    });

    // Extract any tool_use blocks from the response
    const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

    // If the agent stopped calling tools, the investigation is complete
    if (toolUses.length === 0) break;

    // Execute all requested tools in parallel and append results
    const toolResults = await Promise.all(
      toolUses.map(async (toolUse) => ({
        type: "tool_result" as const,
        tool_use_id: toolUse.id,
        content: await executeTool(state.repoPath, toolUse.name, toolInputSchema.parse(toolUse.input)),
      })),
    );

    messages.push({ role: "user", content: toolResults });
    iterations++;
  }

  return {
    ...state,
    rawFindings: extractFindings(messages),
    messages,
  };
}
