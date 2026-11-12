---
name: add-event-type
description: Add a new event type to the Orbit protocol end to end. Use when a run needs to record a new kind of fact.
---

# Add an event type

1. Confirm the event is a real, new fact and not derivable from existing events. If unsure, ask.
2. In `packages/protocol/src/events.ts`, add a `z.object({ ...base, type: z.literal('<name>'), ... })`
   member to `OrbitEvent`. Use dotted lowercase names (`area.verb`). Keep payload fields minimal.
3. In `packages/protocol/test/events.test.ts`, add one valid and one invalid parse test.
4. Check `packages/core`: does any projection or invariant in `docs/architecture.md` need updating?
   Update the doc in the same change.
5. If the event is shown in the UI, add handling in `apps/web` through a projection, not ad-hoc state.
6. Run `pnpm format && pnpm check`. A new event is additive; if you changed an existing event,
   stop and write an ADR first (`write-adr`).
