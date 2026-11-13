# Architecture

## Glossary

- **Run** — one execution of an agent against a workspace. Identified by `runId`.
- **Event** — an immutable fact about a run (`OrbitEvent`). Ordered by `seq` within a run.
- **Event store** — append-only log per run; the single source of truth.
- **Projection** — state derived from events (UI messages, pending approvals, file changes).
- **Tool call** — a request by the model to run a tool; has a `callId` and a `risk` level.
- **Risk** — `read` (auto-allow), `write` (batched approval), `dangerous` (hard block).
- **Policy** — maps a tool call to `allow`, `ask` or `deny` from declarative rules.
- **Session** — an ordered list of runs; the conversation the model sees is rebuilt from their logs.
- **Data folder** — `~/.orbit` (or `ORBIT_DATA_DIR`): the SQLite file with all runs and sessions.
- **Approval** — one pause per model turn in which the user reviews every `ask` call with its preview.

## Invariants

1. Events are only appended, never edited or deleted.
2. `seq` per run starts at 1 and increases by 1 with no gaps.
3. Every `tool.requested` is eventually followed by a `tool.decided` and, if allowed, a `tool.result`
   with the same `callId`.
   3a. A `tool.decided` made by the user follows an `approval.requested` that named that call, and an
   approval only names calls that were requested (see ADR 0002).
4. A run ends with exactly one `run.completed` or `run.failed`. Only `file.rolledback` may come
   after it, and only for a call that has a `file.changed` (see ADR 0006).
5. State shown in the UI is a function of the event log only.

## Data flow

model output / user action → runtime → `EventStore.append` → SSE → web projection

## Status of each part

| Part                               | Status      |
| ---------------------------------- | ----------- |
| Event schema, in-memory store      | implemented |
| Write-time validation              | implemented |
| Run projection, invariant checker  | implemented |
| Read-events HTTP endpoint          | implemented |
| Model adapter (OpenAI-compatible)  | implemented |
| Tool registry, agent loop          | implemented |
| Read-only file tools, sandbox      | implemented |
| SSE run API, demo model, chat UI   | implemented |
| Policy rules, batched approval     | implemented |
| Write tool with diff preview       | implemented |
| Sessions, history, context budget  | implemented |
| Session list, theme, Markdown UI   | implemented |
| SQLite persistence, sessions       | implemented |
| Replay, fork, rollback             | implemented |
| Claims and evidence (report tool)  | implemented |
| MCP client (stdio and HTTP)        | implemented |
| Evaluation (cases, judge, compare) | implemented |
| Token usage per turn               | implemented |
| Several saved models, per run      | implemented |
| Agent profiles (model, tools)      | implemented |
| Several workspaces                 | implemented |
| Archive and delete for good        | implemented |
| Desktop shell                      | planned     |

When you implement a planned part, update this table in the same change.
