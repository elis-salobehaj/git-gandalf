# Architecture (Agent Reference)

Concise reference for the currently implemented GitGandalf architecture.

## Current Runtime Surface

- `src/index.ts`: Hono app entrypoint, calls `initLogging()`, mounts `/api/v1`, enables structured HTTP request logging via `@logtape/hono` middleware (JSON Lines output, health check excluded), exports Bun server config.
- `src/logger.ts`: LogTape configuration module. `initLogging()` sets up JSON Lines logging for the whole app, wires `config.LOG_LEVEL` to the `["gandalf"]` category, appends debug-mode runs to `logs/gg-dev.log`, silences test-mode app logging, and enables implicit context propagation via `AsyncLocalStorage`. Re-exports `getLogger` and `withContext` for the codebase.
- `src/api/router.ts`: owns `POST /api/v1/webhooks/gitlab` and `GET /api/v1/health`. Generates a `requestId` per webhook and propagates it via `withContext()` into the pipeline.
- `src/api/schemas.ts`: strict Zod schemas for GitLab `merge_request` and `note` webhook payloads.
- `src/api/pipeline.ts`: full end-to-end pipeline. Fetches MR metadata and diff, clones or updates the repo cache, runs the review agents, and publishes inline findings plus the summary note.
- `src/config.ts`: Zod-validated singleton config parsed from `process.env` at module load time.
- `src/gitlab-client/client.ts`: typed wrapper around `@gitbeaker/rest` for MR metadata, diffs, discussions, and posting comments.
- `src/context/repo-manager.ts`: shallow clone/update cache manager using `Bun.spawn()` + native `git`.
- `src/context/tools/`: modular tool surface used by the investigator agent during repository review.
- `src/agents/`: shared review subsystem containing shared state, Bedrock client wrapper, three agents, and the orchestrator invoked by the API pipeline.

## Webhook Flow (Implemented)

1. GitLab sends `merge_request` or `note` webhook to `POST /api/v1/webhooks/gitlab`.
2. Router verifies `X-Gitlab-Token` against `config.GITLAB_WEBHOOK_SECRET`.
3. Router parses JSON body and validates it with `webhookPayloadSchema.safeParse()`.
4. Router filters events:
	- merge requests: `open`, `update`, `reopen`
	- notes: `/ai-review` comments on `MergeRequest`
5. Router generates a `requestId` via `Bun.randomUUIDv7()` and calls `withContext({ requestId }, ...)` to propagate it through all downstream logging.
6. Matching events call `runPipeline(event)` without awaiting and return `202 Accepted`.
7. Non-matching events return `200 Ignored`; invalid payloads return `400`; bad secret returns `401`.

## Request Correlation (Implemented)

- `requestId` is generated in the router via `Bun.randomUUIDv7()` immediately after a webhook is accepted.
- `withContext({ requestId })` in the router and `withContext({ projectId, mrIid })` in the pipeline entry propagate these values as implicit context through LogTape's `AsyncLocalStorage`.
- Every log line emitted anywhere in the webhook → pipeline → orchestrator → agents → publisher flow automatically carries `requestId`, `projectId`, and `mrIid` without any module needing to pass them explicitly.

## Context Engine (Implemented)

### `RepoManager`

- Cache key: `<REPO_CACHE_DIR>/<projectId>`
- first clone: `git clone --depth 1 --branch <branch>`
- update path: `git fetch origin <branch> --depth 1` then `git reset --hard origin/<branch>`
- cleanup: TTL-based eviction using directory `mtime`
- security: refuses to inject the GitLab token into clone URLs whose hostname does not match `config.GITLAB_URL`

### Tool Surface

- `read_file`: reads up to 500 lines, prefixes 1-based line numbers
- `search_codebase`: runs `rg --json`, parses NDJSON, caps results at `config.MAX_SEARCH_RESULTS`
- `get_directory_structure`: directory tree up to depth 3, ignores `.git`, `node_modules`, `dist`, etc.
- `executeTool`: Zod-validates tool inputs before dispatching to implementations
- sandboxing: all file and directory paths are constrained with `path.resolve()` + prefix check

## Agent Review Flow (Implemented)

Phase 3's review subsystem is implemented and invoked from the API pipeline.

- `src/agents/state.ts`: `Finding` schema/type plus `ReviewState`
- `src/agents/llm-client.ts`: thin Bedrock/Anthropic messages wrapper
- `src/agents/context-agent.ts`: derives MR intent, change categories, and investigation hypotheses
- `src/agents/investigator-agent.ts`: runs the tool loop with `TOOL_DEFINITIONS` and `executeTool()`
- `src/agents/reflection-agent.ts`: filters findings and assigns the summary verdict
- `src/agents/orchestrator.ts`: coordinates the three stages and allows one reinvestigation loop

The pipeline currently provides `mrDetails`, `diffFiles`, and `repoPath` before calling the orchestrator.

## Planned But Not Implemented Yet

- Phase 5+: queueing, Kubernetes, provider fallback

## Import Contract

Consumers should import from `src/context/tools` only. `src/context/tools/index.ts` is the public barrel and preserves a stable import path even though tools are split into per-file modules.

For the fuller human-oriented architecture walkthrough, see [`docs/humans/context/ARCHITECTURE.md`](../../humans/context/ARCHITECTURE.md).
