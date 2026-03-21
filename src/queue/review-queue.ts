// ---------------------------------------------------------------------------
// BullMQ review queue (Phase 5.1)
//
// Defines the job-data shape and creates the Queue used by the webhook router
// to enqueue review jobs. The Worker counterpart lives in review-worker.ts.
//
// Job lifecycle:
//  - 3 automatic retry attempts with 5-second exponential backoff
//  - Each attempt is bounded by REVIEW_JOB_TIMEOUT_MS in the worker
//  - Completed jobs retained (last 100) for observability
//  - Failed jobs retained (last 200) for post-mortem inspection
//  - Terminal failures are copied to the review-dead-letter queue by the worker
// ---------------------------------------------------------------------------

import { Queue } from "bullmq";
import type { WebhookPayload } from "../api/schemas";
import type { ReviewTriggerContext } from "../api/trigger";
import { getConnectionOptions } from "./connection";

export { reviewJobDataSchema } from "./job-schemas";

export const REVIEW_QUEUE_NAME = "review";

// ---------------------------------------------------------------------------
// Job data type — must be JSON-serialisable (no functions, no class instances)
// ---------------------------------------------------------------------------

export interface ReviewJobData {
  event: WebhookPayload;
  trigger: ReviewTriggerContext;
  requestId: string;
}

// ---------------------------------------------------------------------------
// Queue factory — creates a new Queue instance pointing at Valkey.
// Only call this when QUEUE_ENABLED=true; constructing the Queue opens a
// connection to Valkey.
// ---------------------------------------------------------------------------

export function createReviewQueue(): Queue<ReviewJobData> {
  return new Queue<ReviewJobData>(REVIEW_QUEUE_NAME, {
    // biome-ignore lint/suspicious/noExplicitAny: BullMQ ConnectionOptions accepts plain options objects
    connection: getConnectionOptions() as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5_000, // 5s → 10s → 20s
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience helper: build the job-data record from the values available in
// the router. Exported so the queue tests can exercise it without BullMQ.
// ---------------------------------------------------------------------------

export function buildReviewJobData(
  event: WebhookPayload,
  trigger: ReviewTriggerContext,
  requestId: string,
): ReviewJobData {
  return { event, trigger, requestId };
}
