# ADR 0001: Model agent runs as an append-only event log

- Status: accepted
- Date: 2026-11-12

## Context

Desktop agent apps commonly keep run state as mutable objects. Users then struggle to see what an
agent did, to undo it, or to resume after a crash. Approval prompts and the agent's own progress
reports are also hard to audit.

## Decision

Every fact about a run is an immutable event appended to a per-run log with a monotonic `seq`.
Current state is a pure function of the log. Event shapes are defined once as zod schemas in
`@orbit/protocol`.

## Consequences

- Replay, fork-from-step, rollback and tracing become projections over the log.
- Claims in an agent's final report can be linked to the events that support them.
- Storage grows with run length; compaction and retention policy are needed later.
- Event schemas become a public contract and need versioning once persisted.
- The first implementation is in-memory; SQLite persistence follows in a later ADR.
