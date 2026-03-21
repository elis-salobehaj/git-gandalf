# Architecture (Agent Reference)

Concise reference for the architecture implemented in the current repo.

## Runtime Surface

- `src/index.ts`: Bun entrypoint. Initializes LogTape, mounts `/api/v1`, applies `@logtape/hono` request logging, exports the Bun server.
- `src/logger.ts`: central logging config. Wires `LOG_LEVEL`, emits JSON Lines, appends debug runs to `logs/gg-dev.log`, and propagates implicit context with `AsyncLocalStorage`.
- `src/config.ts`: Zod-validated config singleton parsed from `process.env`.
- `src/api/router.ts`: verifies `X-Gitlab-Token`, validates webhook payloads, filters supported events, generates `requestId`, and starts the async pipeline.
- `src/api/schemas.ts`: permissive Zod schemas for `merge_request` and `note` webhooks. Required fields are enforced; extra GitLab keys are tolerated.
- `src/api/trigger.ts`: typed review trigger context (`automatic` vs `manual`, source event, optional note id) threaded into the pipeline.
- `src/api/pipeline.ts`: fetches MR metadata and diffs, clones or updates the repo cache, calls `fetchLinkedTickets()` to enrich state with Jira context, runs the review pipeline, and publishes results back to GitLab.
- `src/gitlab-client/client.ts`: typed wrapper over `@gitbeaker/rest` for MR details, diffs, discussions, summary notes, and inline discussions.
- `src/integrations/jira/client.ts`: thin read-only Jira REST API client. Exports `extractTicketKeys()`, `fetchJiraTicket()`, and `fetchLinkedTickets()`. Uses native `fetch`, no SDK dependency. All errors are caught and returned as `null` — never throws.
- `src/context/repo-manager.ts`: shallow clone/update cache manager using native `git` through `Bun.spawn()`.
- `src/context/tools/`: modular tool implementations and the public tool manifest consumed by Agent 2.
- `src/agents/protocol.ts`: app-owned message, tool-call, tool-result, stop-reason, and tool-definition contract.
- `src/agents/provider-fallback.ts`: pure fallback orchestration. Exports `tryProvidersInOrder()` and `ProviderFn` type. No provider SDK imports.
- `src/agents/llm-client.ts`: multi-provider fallback orchestrator. Resolves `LLM_PROVIDER_ORDER`, tries each provider via `tryProvidersInOrder()`, logs fallbacks. The single `chatCompletion()` function consumed by all agents.
- `src/agents/providers/bedrock.ts`: AWS Bedrock Runtime Converse adapter.
- `src/agents/providers/openai.ts`: OpenAI Chat Completions adapter.
- `src/agents/providers/google.ts`: Google Gemini (GenerativeAI) adapter.
- `src/agents/`: context agent, investigator loop, reflection agent, and the orchestrator.
- `src/queue/connection.ts`: parses `VALKEY_URL` into BullMQ connection options (no standalone ioredis).
- `src/queue/dead-letter.ts`: dead-letter queue factory and helpers for terminally failed review jobs.
- `src/queue/review-queue.ts`: BullMQ Queue factory, `ReviewJobData` type and Zod schema, `buildReviewJobData()` helper.
- `src/queue/review-worker-core.ts`: pure timeout-bound processor used by the worker and unit tests.
- `src/queue/review-worker.ts`: BullMQ Worker factory — validates job data, enforces `REVIEW_JOB_TIMEOUT_MS`, calls `runPipeline()`, and moves terminal failures to the dead-letter queue.
- `src/worker.ts`: worker process entrypoint. TLS bootstrap, graceful SIGTERM/SIGINT shutdown.
- `src/publisher/gitlab-publisher.ts`: publishes verified findings as inline discussions when possible and always posts a summary note.

## Webhook Flow

1. GitLab sends `merge_request` or `note` webhook to `POST /api/v1/webhooks/gitlab`.
2. Router checks `X-Gitlab-Token` against `config.GITLAB_WEBHOOK_SECRET`.
3. Router parses JSON and validates `webhookPayloadSchema` with `safeParse()`.
4. Router accepts only:
	- merge requests with action `open`, `update`, or `reopen`
	- note events on `MergeRequest` whose text begins with `/ai-review`
5. Router generates `requestId` via `Bun.randomUUIDv7()`.
6. Router builds `ReviewTriggerContext` (`automatic` for MR events, `manual` for `/ai-review` notes).
7. Dispatch branches on `QUEUE_ENABLED`:
	- `true`: job added to BullMQ `review` queue via Valkey; a separate worker process picks it up and calls `runPipeline()`.
	- `false` (default): `runPipeline(event, trigger)` called inline inside `withContext({ requestId })` without awaiting it (fire-and-forget; original behaviour).
8. HTTP response returns immediately:
	- `202 Accepted` for supported review triggers
	- `200 Ignored` for valid but unsupported events
	- `400` for invalid JSON or invalid payloads
	- `401` for bad secret

## Request Correlation

- Router sets `requestId`.
- Pipeline adds `projectId` and `mrIid`.
- LogTape implicit context carries those fields across the full async path: router -> pipeline -> orchestrator -> publisher.

## Repo And Tool Layer

### Repo manager

- cache key: `<REPO_CACHE_DIR>/<projectId>-<url-encoded-branch>`
- clone path: `git clone --depth 1 --branch <branch>`
- refresh path: `git fetch origin refs/heads/<branch>:refs/remotes/origin/<branch> --depth 1` then `git reset --hard origin/<branch>`
- cleanup: TTL eviction using directory `mtime`
- host guard: clone URL hostname must match `config.GITLAB_URL`
- TLS / custom CA: when `GITLAB_CA_FILE` is set, `GIT_SSL_CAINFO` is injected into every git subprocess via `buildGitEnv()`; `NODE_EXTRA_CA_CERTS` is set at startup in `src/index.ts` so `@gitbeaker/rest` fetch calls trust the same CA bundle
- auth: GitLab token injected as `oauth2:<token>` HTTP basic auth in clone URLs; works for both GitLab.com and self-hosted deployments with PAT tokens

### Tool surface

- `read_file`: reads a sandboxed file and prefixes 1-based line numbers
- `search_codebase`: shells out to `rg --json`, parses NDJSON, caps results at `MAX_SEARCH_RESULTS`
- `get_directory_structure`: directory tree up to depth 3 with common heavy directories ignored
- `TOOL_DEFINITIONS`: internal tool manifest exported from `src/context/tools/index.ts`
- `executeTool()`: validates tool inputs with Zod before dispatching

All tool file access is sandboxed with `path.resolve()` plus repo-root prefix checks.

## Review Pipeline

The pipeline is fully implemented and invoked from `src/api/pipeline.ts`.

1. `fetchLinkedTickets()` extracts Jira ticket keys from the MR title and description, fetches each ticket from the Jira REST API, and attaches them to `ReviewState.linkedTickets`. Keys are extracted with `/\b([A-Z][A-Z0-9]+-\d+)\b/g`, which handles prefixes like `SRT-28326:` at the start of MR titles. This step is skipped when `JIRA_ENABLED=false`.
2. `contextAgent()` derives `mrIntent`, `changeCategories`, and `riskAreas`. When `linkedTickets` is non-empty, the prompt includes a `## Linked Jira Tickets` section with summary, status, type, priority, assignee, description, and acceptance criteria.
3. `investigatorLoop()` calls Bedrock through `chatCompletion()`, executes tool calls, and accumulates raw findings.
4. `reflectionAgent()` filters unsupported or weak findings and assigns the verdict.
5. `orchestrator.ts` allows one reinvestigation round when `needsReinvestigation` is true.

### Internal protocol boundary

- All agent state uses `src/agents/protocol.ts`, not provider SDK types.
- `src/agents/llm-client.ts` is the only place that knows about provider names and the fallback ordering. Agents call `chatCompletion()` with no knowledge of which provider handles the request.
- Provider adapters in `src/agents/providers/` translate the internal `AgentMessage[]` / `AgentResponse` contract to and from each SDK's native types.
- Tool definitions are also internalized, so the investigator loop does not depend on provider SDK tool schemas.

### Tool-failure behavior

- Individual tool failures do not abort the whole review.
- `investigatorLoop()` catches tool execution errors and feeds them back to the model as error `tool_result` blocks.
- This lets Agent 2 recover from missing files or bad tool inputs instead of crashing the pipeline.

## Publishing Behavior

- Verified findings are published as inline discussions when they can be anchored to the MR diff.
- Findings that cannot be anchored are skipped for inline publication but still contribute to the summary verdict.
- A summary note is always posted with the final verdict.

## Deployment Targets

- **Docker Compose**: `docker-compose.yml` runs `git-gandalf` (webhook), `worker`, and `valkey` services. Worker uses `stop_grace_period: 11m`.
- **Kubernetes**: `k8s/` directory contains full manifests — `namespace`, `configmap`, `secret`, `deployment` (2 replicas), `worker-deployment` (1 replica, 660s `terminationGracePeriodSeconds`), `service` (ClusterIP), and `valkey` (dev/KinD only). `REVIEW_JOB_TIMEOUT_MS` is set in the ConfigMap for worker timeout control.

For the fuller human walkthrough, see [`docs/humans/context/ARCHITECTURE.md`](../../humans/context/ARCHITECTURE.md).
