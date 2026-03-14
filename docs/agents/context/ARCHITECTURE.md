# Architecture (Agent Reference)

Concise reference for the currently implemented GitGandalf architecture.

## Current Runtime Surface

- `src/index.ts`: Hono app entrypoint, mounts `/api/v1`, enables request logging, exports Bun server config.
- `src/api/router.ts`: owns `POST /api/v1/webhooks/gitlab` and `GET /api/v1/health`.
- `src/api/schemas.ts`: strict Zod schemas for GitLab `merge_request` and `note` webhook payloads.
- `src/api/pipeline.ts`: Phase 1 stub; currently logs the accepted event and project id.
- `src/config.ts`: Zod-validated singleton config parsed from `process.env` at module load time.
- `src/gitlab-client/client.ts`: typed wrapper around `@gitbeaker/rest` for MR metadata, diffs, discussions, and posting comments.
- `src/context/repo-manager.ts`: shallow clone/update cache manager using `Bun.spawn()` + native `git`.
- `src/context/tools/`: modular tool surface used by the future investigator agent.
- `src/agents/`: standalone Phase 3 review subsystem containing shared state, Bedrock client wrapper, three agents, and the orchestrator.

## Webhook Flow (Implemented)

1. GitLab sends `merge_request` or `note` webhook to `POST /api/v1/webhooks/gitlab`.
2. Router verifies `X-Gitlab-Token` against `config.GITLAB_WEBHOOK_SECRET`.
3. Router parses JSON body and validates it with `webhookPayloadSchema.safeParse()`.
4. Router filters events:
	- merge requests: `open`, `update`, `reopen`
	- notes: `/ai-review` comments on `MergeRequest`
5. Matching events call `runPipeline(event)` without awaiting and return `202 Accepted`.
6. Non-matching events return `200 Ignored`; invalid payloads return `400`; bad secret returns `401`.

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

## Standalone Agent Review Flow (Implemented)

Phase 3 is implemented as a standalone subsystem, but it is not wired into the API pipeline yet.

- `src/agents/state.ts`: `Finding` schema/type plus `ReviewState`
- `src/agents/llm-client.ts`: thin Bedrock/Anthropic messages wrapper
- `src/agents/context-agent.ts`: derives MR intent, change categories, and investigation hypotheses
- `src/agents/investigator-agent.ts`: runs the tool loop with `TOOL_DEFINITIONS` and `executeTool()`
- `src/agents/reflection-agent.ts`: filters findings and assigns the summary verdict
- `src/agents/orchestrator.ts`: coordinates the three stages and allows one reinvestigation loop

This subsystem currently expects its caller to provide `mrDetails`, `diffFiles`, and `repoPath`.
Phase 4 will connect those inputs from the webhook/API path.

## Planned But Not Implemented Yet

- Phase 4: `src/publisher/gitlab-publisher.ts` and full pipeline wiring
- Phase 5+: queueing, Kubernetes, provider fallback

## Import Contract

Consumers should import from `src/context/tools` only. `src/context/tools/index.ts` is the public barrel and preserves a stable import path even though tools are split into per-file modules.

For the fuller human-oriented architecture walkthrough, see [`docs/humans/context/ARCHITECTURE.md`](../../humans/context/ARCHITECTURE.md).
