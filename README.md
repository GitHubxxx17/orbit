# Orbit

A local-first, event-sourced AI agent workbench.

Orbit records everything an agent does as an immutable event log. Replay, fork, rollback and
observability are derived from that log instead of being bolted on.

> Status: early development. Not usable yet.

## Design goals

- **Event-sourced runs** — every model output, tool call, approval and file change is an event.
- **Risk-tiered policy** — declarative rules instead of a prompt for every action.
- **Claims backed by evidence** — "tests passed" links to the real command event.
- **Model-agnostic** — any OpenAI-compatible endpoint, pluggable providers and MCP tools.

## Repository layout

| Path                | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `packages/protocol` | Shared event schemas (zod), the contract |
| `packages/core`     | Event store and the agent runtime        |
| `apps/server`       | Local HTTP server (Hono), loopback only  |
| `apps/web`          | React 19 + Vite + Tailwind CSS UI        |
| `docs/adr`          | Architecture decision records            |

## Getting started

Requires Node.js >= 22.12 and pnpm >= 10.13.

```bash
pnpm install
cp .env.example .env   # then fill in your own key; .env is git-ignored
pnpm dev
pnpm check             # format, lint, typecheck, test, build
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
