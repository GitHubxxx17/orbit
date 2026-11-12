# @orbit/core

Event store and the agent runtime.

- State is derived from the event log; keep derivation functions pure and side-effect free.
- `EventStore.append` is the only write path. `seq` is assigned by the store, starting at 1 per
  run, with no gaps. Never accept caller-provided `id`, `seq` or `ts`.
- Inject `Clock` and `IdGenerator`; tests must be deterministic (no real time, no randomness).
- No HTTP, no UI, no direct filesystem access in this package except behind an interface that
  tests can fake.
- Add a persistent store (SQLite) as another `EventStore` implementation, not by changing callers.
  Run the same contract tests against every implementation.
- Policy decisions are pure and synchronous. `dangerous` is always refused and an unknown tool is
  always refused; neither can be changed by configuration. Waiting for the user goes through the
  injected `Approver`, never through UI code (ADR 0002).
- Conversation history is derived from event logs (`historyFromRuns`), never stored separately
  (ADR 0003). Anything the model must be able to see again later has to be in an event.
- `fitToBudget` must keep every assistant tool call next to its tool answers; test it with the
  pairing check before changing it.
