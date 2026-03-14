# GitGandalf

> Self-hosted, multi-agent code review service for GitLab.

GitGandalf intercepts GitLab Merge Request events, deeply reasons about code changes using LLM-powered agents, and posts high-signal inline review comments directly on the MR.

## Tech Stack

- **Runtime**: Bun · **Framework**: Hono · **Language**: TypeScript (strict)
- **LLM**: AWS Bedrock (Claude Sonnet 4) · **GitLab**: @gitbeaker/rest
- **Validation**: Zod · **Lint/Format**: Biome

## Quick Start

See [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md) for prerequisites and setup instructions.

## Documentation

Full documentation index: [`docs/README.md`](docs/README.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).
