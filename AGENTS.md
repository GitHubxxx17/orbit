# Orbit — instructions for AI coding agents

Local-first, event-sourced AI agent workbench. TypeScript monorepo (pnpm + Turborepo).
Read `docs/architecture.md` before changing anything in `packages/` or `apps/server`.

## Commands

- `pnpm install` — install (Node >= 22.12, pnpm 10.13; versions are pinned, do not use ranges)
- `pnpm check` — **the definition of done**: format, lint, typecheck, test, build
- `pnpm --filter @orbit/core test` — run one package's tests
- `pnpm format` — auto-fix formatting (run before `pnpm check`)

## Layout and dependency direction

- `packages/protocol` — zod event schemas, the contract. Depends on nothing internal.
- `packages/core` — event store and runtime. May import `protocol` only.
- `packages/tools` — built-in tools and the workspace sandbox. May import `core`.
- `packages/store-sqlite` — SQLite event and session stores. May import `core` and `protocol`.
- `packages/mcp` — MCP client and its tools. May import `core` and `protocol`.
- `packages/eval` — offline evaluation (cases, checks, judge, comparison). May import `core`, `protocol` and `tools`.
- `apps/server` — Hono HTTP server. May import `core`, `tools`, `store-sqlite`, `mcp` and `protocol`.
- `apps/web` — React UI. May import `protocol` only (types and schemas), never `core`.
- Boundaries are enforced by ESLint; a violation fails `pnpm check`.
- Each package has its own `AGENTS.md`; the nearest one wins.

## Hard rules

- Run state is an append-only event log. Never mutate or delete a stored event. The single
  exception is deleting the whole runs of an _archived_ conversation the user chose to delete for
  good (`EventStore.deleteRuns`, ADR 0015); the database refuses it for anything else.
- Define an event shape once, in `packages/protocol`. Do not redeclare it elsewhere.
- Validate every external input (HTTP, files, model output, MCP) with zod before use.
- Server binds to `127.0.0.1` only. Do not change this without an ADR.
- Never read, print or commit `.env` or any secret. Use `.env.example` for new variables.
- No `any`, no `// @ts-ignore`; use `unknown` and narrow. Prefer exact dependency versions.
- Do not add a dependency without saying why; check `npm view <pkg> version` instead of guessing.

## Workflow

1. Restate the task and list the files you expect to touch. Ask if the request is ambiguous.
2. Write or update a test first for behavior changes; tests live in each package's `test/` directory, mirroring `src/` (`test/<path>.test.ts`); never put `*.test.ts` under `src/`.
3. Make the smallest change that solves the task. No unrelated refactors or reformatting.
4. Run `pnpm format && pnpm check`. Do not report success unless it passes; paste failures verbatim.
5. Changing a public contract (event schema, HTTP API) or a major technology choice requires a new
   ADR in `docs/adr/` (see `.agents/skills/write-adr`).
6. Do not commit or push unless explicitly asked. Commit messages use Conventional Commits.

## Style

- ESM only, `import type` for types, no default exports in library code.
- Pure functions for state derivation; inject clock and id generator instead of calling
  `Date.now()` or `crypto.randomUUID()` in logic that needs testing.
- Comments explain why, not what. Keep functions short and typed at module boundaries.

## Skills (`.agents/skills/`)

- `add-event-type` — add a new event to the protocol end to end.
- `write-adr` — record an architecture decision.
