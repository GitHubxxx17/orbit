# @orbit/store-sqlite

SQLite implementations of `EventStore` and `SessionStore` (ADR 0004).

- Depends on `@orbit/core` and `@orbit/protocol` only. Never import apps or tools.
- Events are append-only. Never add an UPDATE on `events`, and never a DELETE except
  `deleteRuns`, which the trigger only allows for runs of an archived conversation (ADR 0015).
- A schema change means a new migration step and a bump of `SCHEMA_VERSION`. Never edit the SQL of
  an already released version.
- Validate with the protocol schema on write and on read. An unreadable row must throw.
- Anything that opens a file database goes through `openDatabase` (folder 0700, file 0600, WAL).
- Run the shared contract suites from `@orbit/core/testing` against every change; add behaviour
  that is specific to SQLite in `test/sqlite.test.ts`.
- Tests use a temporary folder, never `~/.orbit`.
