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
  in sync with `test/agent/prompt.test.ts`. It is off by default in the server (ADR 0017): the
  prompt has the reporting rules only when the run has the tool (`buildSystemPrompt`).

- The loop has no small step limit (ADR 0010). `maxSteps` is a high safety ceiling; being stuck is
  caught by `RepeatTracker` (same call, same result, three times). Either way the model is asked
  once more, without tools, for an answer, and the run ends `failed` with `EARLY_STOP_PREFIX`. A
  user's Stop must still end the run at once, with no further model call.

- `ToolRegistry.pick` only narrows: it returns a registry with a subset of the tools and ignores
  names that are not registered. Agent profiles use it (ADR 0013); never add a way to widen.

- A run sends what `ContextWindow` gives (ADR 0016), not a freshly trimmed copy on every step: the
  history is masked in one go at a share of the window and left alone until it grows again, so each
  request starts like the previous one and the provider's prompt cache applies. Do not add anything
  that rewrites earlier messages on every call. Cache hits are read per provider in
  `llm/cache-usage.ts`; a provider that does not say gives `null`, never 0. A tool marked
  `idempotent` may be answered with a note when the same call is repeated; only mark tools that
  merely read the workspace.
