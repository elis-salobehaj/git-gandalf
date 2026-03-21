// ---------------------------------------------------------------------------
// Queue job Zod schemas
//
// Pure Zod definitions with no BullMQ dependency — kept in a separate module
// so queue.test.ts can import them without being affected by the mock.module()
// override applied to review-queue.ts in webhook.test.ts.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const reviewTriggerContextSchema = z.object({
  mode: z.enum(["automatic", "manual"]),
  source: z.enum(["merge_request_event", "mr_note_command"]),
  noteId: z.number().optional(),
  rawCommand: z.string().optional(),
});

/**
 * Zod schema for ReviewJobData used at the worker boundary to re-validate
 * deserialized job data after JSON roundtrip through BullMQ.
 */
export const reviewJobDataSchema = z.object({
  event: z.record(z.string(), z.unknown()),
  trigger: reviewTriggerContextSchema,
  requestId: z.string().min(1),
});
