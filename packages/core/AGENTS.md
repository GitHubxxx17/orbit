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
- A store implementation is correct when it passes the contract suites in `src/testing.ts`
  (`@orbit/core/testing`). Add a rule there first, then make every implementation satisfy it.
- Stores hand out copies: changing a returned event or session must never change what is stored.

- The `report` tool (`src/tools/report.ts`) records the agent's claims; whether they have evidence is
  decided by `checkReport`, never by the model (ADR 0007). Keep the system prompt's reporting rules
  in sync with `test/agent/prompt.test.ts`.

- The loop has no small step limit (ADR 0010). `maxSteps` is a high safety ceiling; being stuck is
  caught by `RepeatTracker` (same call, same result, three times). Either way the model is asked
  once more, without tools, for an answer, and the run ends `failed` with `EARLY_STOP_PREFIX`. A
  user's Stop must still end the run at once, with no further model call.
