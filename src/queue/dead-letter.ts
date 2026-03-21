// ---------------------------------------------------------------------------
// Dead-letter queue support for permanently failed review jobs.
//
// When a review job exhausts all attempts, the worker copies the original job
// payload plus failure metadata into a dedicated BullMQ queue so operators can
// inspect, replay, or alert on terminal failures separately from the primary
// queue's transient retry flow.
// ---------------------------------------------------------------------------

import { Queue } from "bullmq";
import { z } from "zod";
import { getConnectionOptions } from "./connection";
import { reviewTriggerContextSchema } from "./job-schemas";
import type { ReviewJobData } from "./review-queue";

export const REVIEW_DEAD_LETTER_QUEUE_NAME = "review-dead-letter";

export const reviewDeadLetterJobDataSchema = z.object({
  event: z.record(z.string(), z.unknown()),
  trigger: reviewTriggerContextSchema,
  requestId: z.string().min(1),
  originalJobId: z.string().min(1),
  attemptsMade: z.coerce.number().int().positive(),
  maxAttempts: z.coerce.number().int().positive(),
  failedAt: z.string().datetime(),
  error: z.string().min(1),
  failureReason: z.enum(["timeout", "processor_error"]),
});

export type ReviewDeadLetterJobData = z.infer<typeof reviewDeadLetterJobDataSchema>;

export interface ReviewDeadLetterQueueLike {
  add(name: string, data: ReviewDeadLetterJobData): Promise<unknown>;
}

export function createReviewDeadLetterQueue(): Queue<ReviewDeadLetterJobData> {
  return new Queue<ReviewDeadLetterJobData>(REVIEW_DEAD_LETTER_QUEUE_NAME, {
    // biome-ignore lint/suspicious/noExplicitAny: BullMQ ConnectionOptions accepts plain options objects
    connection: getConnectionOptions() as any,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1_000 },
    },
  });
}

export function hasExhaustedAttempts(attemptsMade: number, maxAttempts: number): boolean {
  return attemptsMade >= maxAttempts;
}

export function buildReviewDeadLetterJobData(
  data: ReviewJobData,
  options: {
    originalJobId: string;
    attemptsMade: number;
    maxAttempts: number;
    error: string;
    failureReason: "timeout" | "processor_error";
    failedAt?: string;
  },
): ReviewDeadLetterJobData {
  return {
    event: data.event,
    trigger: data.trigger,
    requestId: data.requestId,
    originalJobId: options.originalJobId,
    attemptsMade: options.attemptsMade,
    maxAttempts: options.maxAttempts,
    failedAt: options.failedAt ?? new Date().toISOString(),
    error: options.error,
    failureReason: options.failureReason,
  };
}

export async function enqueueReviewDeadLetter(
  deadLetterQueue: ReviewDeadLetterQueueLike,
  data: ReviewJobData,
  options: {
    originalJobId: string;
    attemptsMade: number;
    maxAttempts: number;
    error: string;
    failureReason: "timeout" | "processor_error";
    failedAt?: string;
  },
): Promise<ReviewDeadLetterJobData> {
  const payload = buildReviewDeadLetterJobData(data, options);
  await deadLetterQueue.add(REVIEW_DEAD_LETTER_QUEUE_NAME, payload);
  return payload;
}
