# Getting Started

This guide gets the current implemented GitGandalf runtime running locally.

## Prerequisites

- Bun
- Git
- ripgrep (`rg`) for the context tools
- a GitLab token and webhook secret
- Bedrock bearer token values for the AWS Bedrock Runtime Converse client used by the agent pipeline

## 1. Install dependencies

```bash
bun install
```

## 2. Create your local environment file

Start from `.env.example` and provide real values.

Required values today:

- `GITLAB_URL`
- `GITLAB_TOKEN`
- `GITLAB_WEBHOOK_SECRET`
- `AWS_BEARER_TOKEN_BEDROCK`

Important:

- keep `AWS_AUTH_SCHEME_PREFERENCE='smithy.api#httpBearerAuth'` quoted
- the implemented LLM path uses the AWS SDK Bedrock Runtime Converse API with bearer-token auth
- `MAX_SEARCH_RESULTS` controls the cap used by `search_codebase`
- `REPO_CACHE_DIR` is where shallow clones will be cached
- `GITLAB_URL` must be the GitLab base URL, for example `https://gitlab.example.com`, not the webhook settings page URL

## GitLab personal access token (GLPAT)

This service uses `GITLAB_TOKEN` in two places:

- GitLab API calls to read MR data and publish review comments
- HTTPS git clone/fetch operations in the repo cache manager

Create a token with a dedicated bot or service account when possible.

For GitLab.com or self-hosted GitLab:

1. Open GitLab and go to your avatar → Preferences or Edit profile → Access tokens.
2. Create a personal access token named something like `git-gandalf-local-dev`.
3. Set an expiry date that matches your local-security requirements.
4. Grant the `api` scope.

`api` is the minimum practical scope for the current implementation because it covers:

- merge request reads
- discussion and note creation
- authenticated HTTPS repository access for clone/fetch

After creating the token, set it as `GITLAB_TOKEN` in `.env`.

## GitLab webhook secret

`GITLAB_WEBHOOK_SECRET` is just a shared secret string between GitLab and this service.
It does not come from GitLab automatically; you generate it yourself.

One simple way to create it locally:

```bash
openssl rand -hex 32
```

Then:

1. Put that value in `.env` as `GITLAB_WEBHOOK_SECRET`.
2. In GitLab, open the target project.
3. Go to Settings → Webhooks.
4. Set the webhook URL to your GitGandalf endpoint.
5. Paste the same secret into the webhook secret/token field.
6. Subscribe to merge request events and, if you want `/ai-review`, note events.

The exact field label varies slightly by GitLab version, but the value must match the
`X-Gitlab-Token` header GitLab sends.

## Project webhook vs system hook

If your goal is to have GitGandalf review merge requests across the entire GitLab instance,
a system hook is a valid approach on self-hosted GitLab when you have administrator access.

What works well with a system hook today:

- one admin-level webhook instead of configuring each project separately
- merge request events across the whole instance
- the same shared-secret validation using `X-Gitlab-Token`

Important limits:

- system hooks are an administrator feature for GitLab Self-Managed and GitLab Dedicated, not the general GitLab.com path
- the current runtime is built around merge request and note events; a system hook covers merge request review triggers, but `/ai-review` note-triggered reviews still need a project-level or group-level webhook path
- if you need compatibility with both GitLab.com and self-hosted deployments, keep project webhooks as the baseline configuration until the planned Phase 4.6 compatibility work is complete

### Option A: project webhook

Use this when:

- you want the most portable setup
- you need `/ai-review` note events today
- you are running on GitLab.com or do not have instance-admin access

Setup:

1. Open the target project.
2. Go to Settings → Webhooks.
3. Set the webhook URL to your GitGandalf endpoint.
4. Paste `GITLAB_WEBHOOK_SECRET` into the secret/token field.
5. Subscribe to merge request events and, if you want `/ai-review`, note events.

### Option B: system hook

Use this when:

- you run GitLab Self-Managed
- you have administrator access
- you want automatic MR review coverage across all projects on the instance

Setup:

1. In GitLab, open Admin.
2. Go to System hooks.
3. Add a new webhook pointing at your GitGandalf endpoint.
4. Paste the same `GITLAB_WEBHOOK_SECRET` into the secret token field.
5. Enable at least merge request events.

If you want fully instance-wide automatic reviews, this is the simplest operational model.
If you also want manual `/ai-review` triggers from MR comments, keep a project or group webhook
for note events as well.

## Webhook reachability

GitLab must be able to make an HTTP request to the GitGandalf webhook URL.

What this means in practice:

- if GitLab and GitGandalf run on the same machine, `http://localhost:8020` can work
- if GitLab runs on a different machine, `localhost` on your laptop is not reachable from GitLab
- a reverse proxy is only useful if GitLab can already reach the proxy and the proxy can route traffic to your GitGandalf process

Common setups:

1. Run GitGandalf on a host GitLab can reach directly, then use `http://that-host:8020/api/v1/webhooks/gitlab` or an HTTPS URL in front of it.
2. For early testing, create an SSH reverse tunnel from your machine to a host GitLab can reach.
3. For longer-lived environments, run GitGandalf on a reachable host directly.

For early testing, the simplest terminal-only option is usually an SSH reverse tunnel.
The important detail is direction:


- `ssh -L` exposes a remote service to your local machine
- `ssh -R` exposes your local service on the remote machine

For GitLab to reach a service running on your laptop, you usually want `ssh -R`, not `ssh -L`.

Example when you can SSH to the GitLab host itself:

```bash
ssh -v -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:8020:localhost:8020 \
  gitlab-user@gitlab.example.com
```

Then point the webhook URL at:

```text
http://127.0.0.1:8020/api/v1/webhooks/gitlab
```

That works for short-lived self-hosted testing when the GitLab server is allowed to send webhook requests to its own localhost.

If you need GitLab to hit a different reachable host instead of its own localhost, use a bastion or utility host:

```bash
ssh -N -R 0.0.0.0:8020:localhost:8020 user@reachable-host
```

Then configure the webhook URL to use that host, for example:

```text
http://reachable-host:8020/api/v1/webhooks/gitlab
```

Notes:

- binding `0.0.0.0` on the remote side may require `GatewayPorts yes` or `GatewayPorts clientspecified` on the remote SSH server
- `ssh -N` keeps the tunnel open without starting a shell
- this is appropriate for early testing, not a durable production ingress design

For self-hosted GitLab system hooks, remember one more constraint: the GitLab instance itself must be allowed to send requests to that destination. If GitGandalf is only listening on your local machine, GitLab will need either a network route to it or a tunnel/proxy endpoint that is reachable from the GitLab server.

## Jira setup

Jira ticket fetching is planned for Phase 4.5 and is not consumed by the runtime yet.
If you want to prepare the credentials now, use a dedicated Jira service account.

For Jira Cloud:

1. Confirm your Jira base URL, for example `https://your-company.atlassian.net`.
2. Create an API token at Atlassian account settings → Security → API tokens.
3. Record the email address for the Jira account that owns the token.
4. Decide which project keys GitGandalf should be allowed to query.

Recommended values to keep ready for the upcoming phase:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEYS` as a comma-separated allow-list when you want to restrict lookups

Use a Jira account with read-only project access if possible. The planned integration only
needs to read issue details; it does not need permission to edit tickets.

## AWS Bedrock bearer-token setup

The implemented agent pipeline calls Claude through the AWS Bedrock Runtime Converse API.
For the current local setup, the expected auth path is bearer-token auth.

Required values:

- `AWS_REGION`
- `AWS_BEARER_TOKEN_BEDROCK`
- `AWS_AUTH_SCHEME_PREFERENCE='smithy.api#httpBearerAuth'`

If Bedrock auth is misconfigured, the webhook can still return `202 Accepted` because the
review runs in the background, but the pipeline will later fail in `logs/gg-dev.log` with
credential or authorization errors.

## 3. Start the service

```bash
bun run dev
```

The server listens on `PORT` from the config, default `8020`.

## 4. Verify health

```bash
curl http://localhost:8020/api/v1/health
```

Expected response:

```json
{"status":"ok","timestamp":"2026-03-14T00:00:00.000Z"}
```

## 5. Send a sample webhook

```bash
curl -X POST http://localhost:8020/api/v1/webhooks/gitlab \
	-H "Content-Type: application/json" \
	-H "X-Gitlab-Token: <your-webhook-secret>" \
	-d @tests/fixtures/sample_mr_event.json
```

Current behavior:

- matching merge request events return `202 Accepted`
- non-matching but valid events return `200 Ignored`
- accepted events continue through the full pipeline: MR fetch, repo clone/update, agent review, and GitLab publishing
- every accepted request carries `requestId`, `projectId`, and `mrIid` through the log context

## 6. Understand the current scope

Implemented now:

- Hono listener and health endpoint
- required-field Zod webhook parsing with permissive handling of extra GitLab keys
- GitLab client wrapper
- repo cache manager
- modular tool surface for repository investigation
- internal GitGandalf message and tool protocol between the agent runtime and provider adapter
- integrated multi-agent review subsystem (context, investigator, reflection, orchestrator)
- end-to-end pipeline: webhook → agents → GitLab inline comments + summary note
- GitLab publisher with duplicate detection
- recoverable Agent 2 tool errors, returned to the model as error tool results
- structured logging via LogTape: JSON Lines to stdout, `LOG_LEVEL` filtering, request correlation

Every accepted webhook emits logs with a unique `requestId` plus `projectId` and `mrIid` for end-to-end traceability.

Set `LOG_LEVEL=debug` for verbose per-agent output, or `LOG_LEVEL=warn` for quiet production deployments. In debug mode, logs are also written to `logs/gg-dev.log` under the project root.

Still planned:

- Phase 4.5 ticket context integration for Jira-backed issue enrichment
- Phase 4.6 GitLab.com and self-hosted compatibility hardening
- Phase 5 production hardening (task queue, Kubernetes, provider fallback)

## Useful next commands

```bash
bun test
bun run typecheck
bun run check
```
