# ADR 0004: Persist runs and sessions in SQLite with better-sqlite3

- Status: accepted
- Date: 2026-11-12

## Context

Runs and sessions lived in memory, so restarting the server lost every conversation. Replay,
fork, rollback and a session list that survives a restart all need the event log on disk. ADR
0001 already says persistence arrives as another `EventStore` implementation.

Two ways to use SQLite from Node were tried on this machine (macOS, Node 24.4.0) before choosing:

|                    | `node:sqlite` (built in)                                              | `better-sqlite3` 13.1.1                                                                                             |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Works here         | yes (SQLite 3.50.2)                                                   | yes (SQLite 3.54.1)                                                                                                 |
| Warning on use     | yes: "SQLite is an experimental feature and might change at any time" | none                                                                                                                |
| Install            | nothing                                                               | native module, compiled on `pnpm install`                                                                           |
| API                | synchronous                                                           | synchronous, plus a transaction helper                                                                              |
| Electron (planned) | not checked; depends on the Node version inside Electron              | known to need a rebuild for Electron's ABI (reported by other projects that run it in both plain Node and Electron) |

## Decision

1. Use **better-sqlite3**, in a new package `@orbit/store-sqlite`. A database holds whole
   conversations, so a stable, documented API matters more than avoiding a native build; the
   built-in module is still marked experimental in this Node version.
2. `EventStore` stays synchronous, which both libraries allow, so no caller changes.
3. The event table is **append-only at the database level**: triggers abort any UPDATE or DELETE.
   `seq` is assigned inside a transaction. Events are validated with the protocol schema both when
   written and when read; an unreadable row is an error, never silently skipped.
4. Sessions are stored too. Removing a session only hides it (a flag): its events are never
   deleted, and its id and run ids can never be reused. A user-chosen title is stored; otherwise the
   title is derived from the first question as before.
5. The schema version is kept in SQLite's `user_version`. A database written by a newer version
   is refused rather than opened and damaged.
6. The data folder defaults to `~/.orbit` (override: `ORBIT_DATA_DIR`) and is created readable by
   the current user only (folder 0700, file 0600), because the log contains the contents of files
   the agent read. It is not encrypted.
7. On start-up, runs that were still going when the server last stopped are closed: waiting calls
   are recorded as refused, started calls as failed, and the run as failed (all appended, nothing
   rewritten), so the log stays consistent and the UI does not show a run as running forever.
8. One contract test suite (`@orbit/core/testing`) is run against both the in-memory and the SQLite
   stores. A new implementation, including a `node:sqlite` one, is correct when it passes it.

## Consequences

- Conversations survive restarts; the session list, rename, delete and continuing a conversation
  work after a restart.
- Running the server inside Electron will need `better-sqlite3` rebuilt for Electron's ABI, or the
  server kept as a separate process. This was not tried; it is a known cost of this choice. The
  contract suite makes switching to `node:sqlite` cheap if that becomes the better trade.
- Event schemas are now a stored contract: a change that old rows cannot satisfy needs a migration
  (bump `SCHEMA_VERSION`) or a new, additive event type.
- The log grows without limit. Retention and compaction are not designed yet.
- A single process owns the file. Two servers on the same data folder are not supported.
- Anyone who can read the user's files can read the conversations.
