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
