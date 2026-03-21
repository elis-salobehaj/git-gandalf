import { describe, expect, it } from "bun:test";
import type { WebhookPayload } from "../src/api/schemas";
import type { ReviewTriggerContext } from "../src/api/trigger";
import { reviewJobDataSchema } from "../src/queue/job-schemas";
import { buildReviewJobData, REVIEW_QUEUE_NAME } from "../src/queue/review-queue";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleEvent: WebhookPayload = {
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

const automaticTrigger: ReviewTriggerContext = {
  mode: "automatic",
  source: "merge_request_event",
};

const manualTrigger: ReviewTriggerContext = {
  mode: "manual",
  source: "mr_note_command",
  noteId: 7,
  rawCommand: "/ai-review",
};

// ---------------------------------------------------------------------------
// REVIEW_QUEUE_NAME
// ---------------------------------------------------------------------------

describe("REVIEW_QUEUE_NAME", () => {
  it("is the string 'review'", () => {
    expect(REVIEW_QUEUE_NAME).toBe("review");
  });
});

// ---------------------------------------------------------------------------
// buildReviewJobData
// ---------------------------------------------------------------------------

describe("buildReviewJobData", () => {
  it("includes the event, trigger, and requestId in the job data", () => {
    const requestId = "req-123";
    const data = buildReviewJobData(sampleEvent, automaticTrigger, requestId);

    expect(data.event).toBe(sampleEvent);
    expect(data.trigger).toBe(automaticTrigger);
    expect(data.requestId).toBe(requestId);
  });

  it("preserves manual trigger fields (mode, source, noteId, rawCommand)", () => {
    const data = buildReviewJobData(sampleEvent, manualTrigger, "req-456");

    expect(data.trigger.mode).toBe("manual");
    expect(data.trigger.source).toBe("mr_note_command");
    expect(data.trigger.noteId).toBe(7);
    expect(data.trigger.rawCommand).toBe("/ai-review");
  });

  it("returns a plain object (JSON-serialisable by BullMQ)", () => {
    const data = buildReviewJobData(sampleEvent, automaticTrigger, "req-789");
    const roundTripped = JSON.parse(JSON.stringify(data)) as typeof data;

    expect(roundTripped.requestId).toBe("req-789");
    expect(roundTripped.trigger.mode).toBe("automatic");
  });
});

// ---------------------------------------------------------------------------
// reviewJobDataSchema — Zod validation
// ---------------------------------------------------------------------------

describe("reviewJobDataSchema", () => {
  it("accepts a valid automatic review job", () => {
    const payload = {
      event: { object_kind: "merge_request", project: { id: 1 } },
      trigger: { mode: "automatic", source: "merge_request_event" },
      requestId: "abc-123",
    };

    const result = reviewJobDataSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("accepts a valid manual review job with optional noteId and rawCommand", () => {
    const payload = {
      event: { object_kind: "note" },
      trigger: {
        mode: "manual",
        source: "mr_note_command",
        noteId: 99,
        rawCommand: "/ai-review security",
      },
      requestId: "def-456",
    };

    const result = reviewJobDataSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trigger.noteId).toBe(99);
    }
  });

  it("rejects when requestId is missing", () => {
    const payload = {
      event: { object_kind: "merge_request" },
      trigger: { mode: "automatic", source: "merge_request_event" },
    };

    const result = reviewJobDataSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects when requestId is an empty string", () => {
    const payload = {
      event: {},
      trigger: { mode: "automatic", source: "merge_request_event" },
      requestId: "",
    };

    const result = reviewJobDataSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid trigger mode", () => {
    const payload = {
      event: {},
      trigger: { mode: "scheduled", source: "merge_request_event" },
      requestId: "ghi-789",
    };

    const result = reviewJobDataSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid trigger source", () => {
    const payload = {
      event: {},
      trigger: { mode: "automatic", source: "unknown_source" },
      requestId: "jkl-012",
    };

    const result = reviewJobDataSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
