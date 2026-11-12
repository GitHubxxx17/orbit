# @orbit/protocol

The contract package. Everything here is a public interface to every other package.

- Events are a zod `discriminatedUnion` on `type` in `src/events.ts`. Infer TS types from the
  schema (`z.infer`); never write a parallel interface.
- Adding an event: follow `.agents/skills/add-event-type`.
- Changing or removing a field of an existing event is a breaking change: needs an ADR and a
  migration note, because stored logs must stay readable.
- This package must not import any other `@orbit/*` package or any runtime-specific API
  (no `node:*`, no DOM), so both server and web can use it.
- Every schema change needs a test in `src/events.test.ts` covering one valid and one invalid case.
