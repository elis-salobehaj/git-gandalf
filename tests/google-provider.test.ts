import { beforeEach, describe, expect, it, mock } from "bun:test";

const mockSendMessage = mock(async (parts: unknown[]) => ({
  response: {
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(parts) }] },
        finishReason: "STOP",
      },
    ],
  },
}));

mock.module("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(_options: unknown) {
      return {
        startChat: (_startOptions: unknown) => ({
          sendMessage: mockSendMessage,
        }),
      };
    }
  },
}));

const { googleChatCompletion } = await import("../src/agents/providers/google");

describe("googleChatCompletion", () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({
      response: {
        candidates: [
          {
            content: { parts: [{ text: "ok" }] },
            finishReason: "STOP",
          },
        ],
      },
    });
  });

  it("uses the tool name rather than the toolCallId for current-turn functionResponse parts", async () => {
    const { config } = await import("../src/config");
    const originalKey = config.GOOGLE_AI_API_KEY;
    // biome-ignore lint/suspicious/noExplicitAny: intentional test override
    (config as any).GOOGLE_AI_API_KEY = "test-google-key";

    try {
      await googleChatCompletion("system", [
        {
          role: "assistant",
          content: [{ type: "tool_call", id: "call-123", name: "read_file", input: { path: "src/index.ts" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", toolCallId: "call-123", output: "file contents" }],
        },
      ]);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const [parts] = mockSendMessage.mock.calls[0] as [Array<{ functionResponse?: { name: string } }>];
      expect(parts[0]?.functionResponse?.name).toBe("read_file");
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: intentional test override
      (config as any).GOOGLE_AI_API_KEY = originalKey;
    }
  });
});
