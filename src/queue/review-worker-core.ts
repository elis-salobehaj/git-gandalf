// ---------------------------------------------------------------------------
// Pure review-worker processing helpers.
//
// Extracted so timeout behavior can be unit-tested without standing up a real
// BullMQ Worker or Valkey instance.
// ---------------------------------------------------------------------------

import { webhookPayloadSchema } from "../api/schemas";
import type { ReviewTriggerContext } from "../api/trigger";
import { withContext } from "../logger";
import { reviewJobDataSchema } from "./job-schemas";

export class ReviewJobTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Review job timed out after ${timeoutMs}ms`);
    this.name = "ReviewJobTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export async function runReviewJobWithTimeout(
  data: unknown,
  options: {
    timeoutMs: number;
    pipelineRunner: (
      event: ReturnType<typeof webhookPayloadSchema.parse>,
      trigger: ReviewTriggerContext,
    ) => Promise<void>;
  },
): Promise<void> {
  const raw = reviewJobDataSchema.parse(data);
  const event = webhookPayloadSchema.parse(raw.event);
  const trigger = raw.trigger as ReviewTriggerContext;

  let timeoutHandle: Timer | undefined;

  try {
    await Promise.race([
      withContext({ requestId: raw.requestId }, () => options.pipelineRunner(event, trigger)),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new ReviewJobTimeoutError(options.timeoutMs)), options.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
