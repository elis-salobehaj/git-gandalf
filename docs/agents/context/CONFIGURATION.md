# Configuration (Agent Reference)

Compact reference for all environment variables accepted by `src/config.ts`.

| Variable | Required | Type | Default | Notes |
|---|---|---|---|---|
| `GITLAB_URL` | yes | URL string | none | Base URL for the GitLab instance. Used both by `@gitbeaker/rest` and clone-host validation. |
| `GITLAB_TOKEN` | yes | non-empty string | none | Personal/project token for GitLab API access and authenticated clone URL injection. |
| `GITLAB_WEBHOOK_SECRET` | yes | non-empty string | none | Compared against `X-Gitlab-Token` in `POST /api/v1/webhooks/gitlab`. |
| `AWS_REGION` | no | string | `us-west-2` | Used by the implemented AWS Bedrock Runtime Converse client in `src/agents/llm-client.ts`. |
| `AWS_BEARER_TOKEN_BEDROCK` | yes | non-empty string | none | Bearer token used by the implemented Bedrock Runtime client path. |
| `AWS_AUTH_SCHEME_PREFERENCE` | no | string | `smithy.api#httpBearerAuth` | Must be quoted in `.env` files because `#` begins comments in dotenv syntax. Keeps the AWS SDK on the Bedrock bearer-token auth path. |
| `LLM_MODEL` | no | string | `global.anthropic.claude-sonnet-4-6` | Bedrock model ID passed to `ConverseCommand` in `src/agents/llm-client.ts`. |
| `MAX_TOOL_ITERATIONS` | no | positive integer | `15` | Upper bound for tool-call iterations inside `investigatorLoop()`. |
| `MAX_SEARCH_RESULTS` | no | positive integer | `100` | Caps `search_codebase` results returned from ripgrep parsing. |
| `REPO_CACHE_DIR` | no | string | `/tmp/repo_cache` | Root directory for shallow repo clones managed by `RepoManager`. |
| `LOG_LEVEL` | no | enum | `info` | Wired to LogTape via `src/logger.ts`. Controls the `lowestLevel` of the root `["gandalf"]` logger category. Accepted values: `debug`, `info`, `warn`, `error`. Mapped to LogTape's level names internally. When set to `debug` outside tests, logs are also appended to `logs/gg-dev.log` under the project root. |
| `PORT` | no | positive integer | `8020` | Port used by the Bun server export in `src/index.ts`. |

## Validation Rules

- config is parsed once at module load time with `envSchema.parse(process.env)`
- numeric values use `z.coerce.number().int().positive()` where applicable
- invalid configuration fails fast during startup or import
- no provider SDK config leaks past `src/agents/llm-client.ts`; the rest of the app consumes the internal agent protocol only

## Test Environment Notes

- `bun test` auto-loads `.env.test`
- `.env.test` points `REPO_CACHE_DIR` at an isolated test path so repo-manager tests do not touch the production default cache
- fake Bedrock credentials are committed in `.env.test` because the schema requires those fields before modules import

Source of truth remains [`src/config.ts`](../../../src/config.ts).
