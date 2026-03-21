import { describe, expect, it, mock } from "bun:test";
import type { WebhookPayload } from "../src/api/schemas";
import { enqueueReviewDeadLetter, hasExhaustedAttempts, REVIEW_DEAD_LETTER_QUEUE_NAME } from "../src/queue/dead-letter";
import type { ReviewJobData } from "../src/queue/review-queue";
import { ReviewJobTimeoutError, runReviewJobWithTimeout } from "../src/queue/review-worker-core";

const sampleEvent = {
  object_kind: "merge_request",
  event_type: "merge_request",
  project: {
    id: 99,
    web_url: "https://gitlab.example.com/org/repo",
    path_with_namespace: "org/repo",
  },
  user: { id: 1, name: "Alice", username: "alice" },
  object_attributes: {
    iid: 42,
    title: "feat: add payments",
    description: "Stripe integration",
    source_branch: "feat/stripe",
    target_branch: "main",
    action: "open",
    url: "https://gitlab.example.com/org/repo/-/merge_requests/42",
    state: "opened",
  },
} as unknown as WebhookPayload;

const sampleJobData = {
  event: sampleEvent,
  trigger: { mode: "automatic", source: "merge_request_event" },
  requestId: "req-123",
} as const satisfies ReviewJobData;

describe("runReviewJobWithTimeout", () => {
  it("runs the pipeline when it finishes before the timeout", async () => {
    const pipelineRunner = mock(async () => undefined);

    await runReviewJobWithTimeout(sampleJobData, {
      timeoutMs: 50,
      pipelineRunner,
    });

    expect(pipelineRunner).toHaveBeenCalledTimes(1);
  });

  it("throws ReviewJobTimeoutError when the pipeline exceeds the timeout", async () => {
    const pipelineRunner = mock(async () => {
      await new Promise(() => {});
    });

    await expect(
      runReviewJobWithTimeout(sampleJobData, {
        timeoutMs: 5,
        pipelineRunner,
      }),
    ).rejects.toBeInstanceOf(ReviewJobTimeoutError);
  });
});

describe("dead-letter helpers", () => {
  it("detects when attempts are exhausted", () => {
    expect(hasExhaustedAttempts(3, 3)).toBe(true);
    expect(hasExhaustedAttempts(2, 3)).toBe(false);
  });

  it("enqueues terminal failures into the dead-letter queue with failure metadata", async () => {
    const add = mock(async (_name: string, _payload: unknown) => ({ id: "dlq-1" }));

    const payload = await enqueueReviewDeadLetter({ add }, sampleJobData, {
      originalJobId: "job-99",
      attemptsMade: 3,
      maxAttempts: 3,
      error: "Review job timed out after 5000ms",
      failureReason: "timeout",
      failedAt: "2026-03-20T00:00:00.000Z",
    });

    expect(add).toHaveBeenCalledWith(REVIEW_DEAD_LETTER_QUEUE_NAME, payload);
    expect(payload.originalJobId).toBe("job-99");
    expect(payload.failureReason).toBe("timeout");
    expect(payload.failedAt).toBe("2026-03-20T00:00:00.000Z");
  });
});
