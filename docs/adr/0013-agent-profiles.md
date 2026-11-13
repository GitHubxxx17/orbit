# ADR 0013: Agent profiles are configuration that can only narrow

- Status: accepted
- Date: 2026-11-13

## Context

Every run used one fixed prompt, every tool and whichever model was picked. Different jobs (reading
only, reviewing, a cheaper model for small questions) need different setups, and the plan calls for
one configuration per agent. The risk is that a profile becomes a way around the safety rules.

## Decision

1. **A profile is data, not code**: `{ id, name, description, instructions, modelId, tools }`, kept in
   `agents.json` in the data folder (private to the user, written through a temp file). It holds no
   secrets: a model is named by id, never by key.
2. **It can only narrow.** `tools` is an allowlist applied with `ToolRegistry.pick`, which can drop
   tools but never add one. Policy, sandbox, approval and the read-only mode apply to every agent
   unchanged. `report` is always kept, so the evidence check (ADR 0007) works for every agent.
3. **Instructions are appended**, after the built-in system prompt, under a heading that says they
   come from the user. They never replace the built-in rules.
4. **Names are checked when saved**: unknown tools and unknown models are refused with 400. At run
   time a tool that has since disappeared (an MCP server went away) is simply not offered, and an
   agent whose model was deleted falls back to the default model.
5. **Model precedence**: a `modelId` sent with the run, else the agent's, else the default.
6. **Routes**: `GET/POST /agents`, `PUT/DELETE /agents/:id`, `GET /agents/tools`; `POST /runs` takes an
   optional `agentId` (400 if unknown). Only live mode uses profiles; the demo model ignores them.
7. **`run.started` gains an optional `agentName`** (alongside `agentId`, which is the profile id), so
   the line under an answer says which agent answered. Old logs have neither and stay valid.
8. **The built-in agent** (`default`: all tools, plain prompt) is always listed first and cannot be
   edited or removed, so there is always one way to run exactly as before.

## Consequences

- Editing profiles in the browser is fine, unlike MCP servers (ADR 0008): a profile starts no program
  and grants nothing.
- Instructions are the user's own text, so they are trusted like the user's prompt; they are not a
  place for web or tool output.
- Not done: per-agent approval mode, per-agent step limits, sharing or importing profiles, a
  second agent running inside a run (delegation).
