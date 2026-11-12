# ADR 0005: Model settings live in a private JSON file, not in the database

- Status: accepted
- Date: 2026-11-12

## Context

Model credentials came only from `.env`, so changing the model meant editing a file and restarting.
The settings page lets the user set base URL, model and API key in the UI. The key is a secret;
the database holds conversations that may be exported, inspected or (later) shared.

## Decision

1. Settings are stored in `${dataDir}/settings.json`: folder 0700, file 0600, written through a
   temp file and `rename` so a crash never leaves a half-written key. They are **not** stored in
   SQLite and never appear in the event log.
2. Precedence: saved settings > `.env` (`ORBIT_LLM_*`) > none (demo only).
3. The key is **write-only** over HTTP. `GET /settings/model` returns only whether a key exists
   and its last four characters. An update without a key keeps the stored one.
4. `ModelManager` swaps the live client in place. `RunManager` asks for it on every call, so runs
   started afterwards use the new model; a run in progress keeps the client it began with.
5. A base URL must be http(s) with no embedded credentials, and plain `http` is accepted only for
   loopback hosts, because the key would otherwise travel in the clear.
6. "Test connection" sends a tiny request (`max_tokens` 8, 15 s timeout) and reports errors with
   the key redacted. Model names are not prefilled: providers rename them.

## Consequences

- The key is plaintext on disk, protected by file permissions only. The desktop app should move it
  to the OS keychain (Electron `safeStorage`).
- The server has no authentication, so these routes are as exposed as everything else: loopback
  only, Host allowlist, JSON-only (ADR in `apps/server/AGENTS.md`). Remote deployment needs auth first.
