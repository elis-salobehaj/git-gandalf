# GitGandalf Documentation

## 🤖 Agent Documentation (`docs/agents/`)

Concise, token-optimized reference for LLM agents. Prefer these over human docs to minimize context window usage.

- [Architecture](./agents/context/ARCHITECTURE.md) — Current runtime surface, webhook flow, repo manager, tool system, implemented agent pipeline, and planned boundaries
- [Configuration](./agents/context/CONFIGURATION.md) — Environment variables, defaults, required fields, and test-env notes
- [Workflows](./agents/context/WORKFLOWS.md) — Implemented webhook flow, repo cache workflow, full review workflow, and logging/observability behavior
- [Tech Stack Design](./agents/designs/tech-stack-evaluation.md) — Stack decisions and rationale summary

## 👥 Human Documentation (`docs/humans/`)

Detailed, visual documentation with Mermaid diagrams and full rationale.

- [Architecture](./humans/context/ARCHITECTURE.md) — Current implemented architecture, integrated agent pipeline, planned phases, and ELI5 explanation
- [Tech Stack Design](./humans/designs/tech-stack-evaluation.md) — Complete ecosystem analysis and technology decisions

## 📚 Guides (`docs/guides/`)

- [Getting Started](./guides/GETTING_STARTED.md) — Local setup, env configuration, health check, and sample webhook flow
- [Development](./guides/DEVELOPMENT.md) — Bun commands, testing strategy, plan-driven workflow, and tool-module conventions

## 📋 Implementation Plans (`docs/plans/`)

- **Active**: [GitGandalf Master Plan](./plans/active/git-gandalf-master-plan.md) — Phases 1–5 implementation roadmap
- **Implemented**: [Structured Logging](./plans/implemented/structured-logging-plan.md) — LogTape structured logging, request correlation, and docs overhaul across 5 phases
- **Implemented**: [Agentic Development Plan](./plans/implemented/agentic-development-plan.md) — Repo bootstrap and dev tooling setup

### Implementation Status

| Phase | Status | Summary |
|---|---|---|
| **Phase 1** | ✅ Complete | Hono server, Zod webhook parsing, GitLab client wrapper, health and webhook endpoints |
| **Phase 2** | ✅ Complete | Repo cache manager, tool executor, file/search/directory tools, and test coverage foundation |
| **Phase 2.5** | ✅ Complete | Tool-per-file modularization with stable barrel import path in `src/context/tools/` |
| **Phase 3** | ✅ Complete | Shared review state, Bedrock client wrapper, context/investigator/reflection agents, orchestrator, and Phase 3 test coverage |
| **Phase 4** | ✅ Complete | GitLab publisher (inline comments, summary note, duplicate guard), full pipeline wiring, Dockerfile, Docker Compose, README |
| **Logging** | ✅ Complete | LogTape structured logging, `LOG_LEVEL` wired, `@logtape/hono` middleware, request correlation via `withContext()`, debug log file at `logs/gg-dev.log` |
| **Phase 5** | ⬜ Planned | Hardening, BullMQ queue, Kubernetes |

## Current State Summary

Implemented today:

- webhook ingestion and filtering
- strict Zod payload validation
- GitLab data access wrapper
- repo cache manager with host validation
- modular tool surface for investigator agents
- integrated multi-agent review pipeline with context, investigator, reflection, and orchestration stages
- end-to-end pipeline: webhook → agents → GitLab inline comments + summary note
- GitLab publisher with duplicate detection
- Dockerfile and Docker Compose for self-hosted deployment
- structured logging via LogTape (JSON Lines, `LOG_LEVEL` filtering, request correlation, debug file output)

Planned next:

- Phase 5 production hardening (task queue, Kubernetes)
