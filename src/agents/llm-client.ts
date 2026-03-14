// ---------------------------------------------------------------------------
// Thin wrapper around the Anthropic Bedrock SDK.
//
// The AWS credentials are read from the environment by the SDK via the
// standard credential chain (env vars → IAM role → instance profile).
// AWS_BEARER_TOKEN_BEDROCK and AWS_AUTH_SCHEME_PREFERENCE (set in .env) are
// picked up automatically — no explicit credential wiring needed here.
// ---------------------------------------------------------------------------

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import type { Message, MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { config } from "../config";

export const llm = new AnthropicBedrock({
  awsRegion: config.AWS_REGION,
});

/**
 * Send a chat completion request to Claude via Bedrock.
 *
 * @param systemPrompt - The system instruction for this agent.
 * @param messages     - The conversation history (user + assistant turns).
 * @param tools        - Optional Anthropic tool definitions to enable tool_use.
 */
export async function chatCompletion(
  systemPrompt: string,
  messages: MessageParam[],
  tools?: readonly Tool[],
): Promise<Message> {
  return llm.messages.create({
    model: config.LLM_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages,
    ...(tools ? { tools: [...tools] } : {}),
  });
}
