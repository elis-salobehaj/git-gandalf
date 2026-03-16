// ---------------------------------------------------------------------------
// Thin wrapper around the AWS Bedrock Runtime Converse API.
//
// This repo uses bearer-token auth for Bedrock in local/corporate environments.
// The AWS SDK BedrockRuntime client supports the Bedrock bearer-token auth
// scheme directly. We bridge the Converse request/response format into the
// GitGandalf internal message protocol used by the rest of the pipeline.
// ---------------------------------------------------------------------------

import {
  type Message as BedrockMessage,
  BedrockRuntimeClient,
  type ContentBlock,
  ConverseCommand,
  type ConverseCommandOutput,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { config } from "../config";
import type { AgentContentBlock, AgentMessage, AgentResponse, AgentStopReason, AgentToolDefinition } from "./protocol";

const llm = new BedrockRuntimeClient({
  region: config.AWS_REGION,
  token: async () => ({ token: config.AWS_BEARER_TOKEN_BEDROCK }),
});

function toBedrockToolConfig(tools?: readonly AgentToolDefinition[]): ToolConfiguration | undefined {
  if (!tools || tools.length === 0) return undefined;

  return {
    tools: tools.map((definition) => {
      return {
        toolSpec: {
          name: definition.name,
          description: definition.description,
          inputSchema: {
            json: definition.inputSchema,
          },
        },
      };
    }) as ToolConfiguration["tools"],
    toolChoice: { auto: {} },
  };
}

function toBedrockContent(content: AgentContentBlock[]): ContentBlock[] {
  return content.map((block) => {
    if (block.type === "text") {
      return { text: block.text } as ContentBlock;
    }

    if (block.type === "tool_call") {
      return {
        toolUse: {
          toolUseId: block.id,
          name: block.name,
          input: block.input,
        },
      } as ContentBlock;
    }

    if (block.type === "tool_result") {
      const toolResultContent = [{ text: block.output }];

      return {
        toolResult: {
          toolUseId: block.toolCallId,
          content: toolResultContent,
          status: block.isError ? "error" : "success",
        },
      } as ContentBlock;
    }

    throw new Error(`Unsupported message block type for Bedrock conversion: ${JSON.stringify(block)}`);
  });
}

function toBedrockMessages(messages: AgentMessage[]): BedrockMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: toBedrockContent(message.content),
  }));
}

function toAgentContent(content: ContentBlock[]): AgentContentBlock[] {
  const agentContent: AgentContentBlock[] = [];

  for (const block of content) {
    if ("text" in block && typeof block.text === "string") {
      agentContent.push({ type: "text", text: block.text });
      continue;
    }

    if ("toolUse" in block && block.toolUse) {
      agentContent.push({
        type: "tool_call",
        id: block.toolUse.toolUseId ?? Bun.randomUUIDv7(),
        name: block.toolUse.name ?? "unknown_tool",
        input: (block.toolUse.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  return agentContent;
}

function toStopReason(stopReason?: string): AgentStopReason {
  switch (stopReason) {
    case "end_turn":
    case "max_tokens":
    case "stop_sequence":
    case "pause_turn":
    case "refusal":
      return stopReason;
    case "tool_use":
      return "tool_call";
    default:
      return "unknown";
  }
}

function toAgentResponse(response: ConverseCommandOutput): AgentResponse {
  const output = response.output;
  const content = output?.message?.content ?? [];

  return {
    message: {
      role: "assistant",
      content: toAgentContent(content),
    },
    stopReason: toStopReason(response.stopReason),
  };
}

/**
 * Send a chat completion request to Claude via the Bedrock Converse API.
 *
 * @param systemPrompt - The system instruction for this agent.
 * @param messages     - The conversation history (user + assistant turns).
 * @param tools        - Optional internal tool definitions to enable model tool calls.
 */
export async function chatCompletion(
  systemPrompt: string,
  messages: AgentMessage[],
  tools?: readonly AgentToolDefinition[],
): Promise<AgentResponse> {
  const response: ConverseCommandOutput = await llm.send(
    new ConverseCommand({
      modelId: config.LLM_MODEL,
      system: [{ text: systemPrompt }],
      messages: toBedrockMessages(messages),
      inferenceConfig: {
        maxTokens: 8192,
      },
      toolConfig: toBedrockToolConfig(tools),
    }),
  );

  return toAgentResponse(response);
}
