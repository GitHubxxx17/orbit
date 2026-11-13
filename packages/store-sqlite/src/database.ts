import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

export type Db = Database.Database;

/** The schema version this code understands; stored in SQLite's `user_version`. */
export const SCHEMA_VERSION = 2;

const SCHEMA_V1 = `
  -- Every fact about a run. Rows are only ever added: the triggers below refuse any change.
  CREATE TABLE events (
    run_id TEXT NOT NULL,
    seq    INTEGER NOT NULL,
    id     TEXT NOT NULL,
    ts     INTEGER NOT NULL,
    type   TEXT NOT NULL,
    data   TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  ) WITHOUT ROWID;

  CREATE TRIGGER events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

  CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

  CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    title      TEXT,
    removed    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE session_runs (
    run_id     TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions (session_id),
    position   INTEGER NOT NULL,
    UNIQUE (session_id, position)
  );
`;

/**
 * Version 2 (ADR 0015): events may be deleted, but only those of a run whose conversation is in
 * the archive (`removed = 1`). The rule lives in the database, so a bug elsewhere still cannot
 * delete the history of a conversation that is in use. Changing an event is still never allowed.
 */
const SCHEMA_V2 = `
  DROP TRIGGER events_no_delete;

  CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  WHEN NOT EXISTS (
    SELECT 1 FROM session_runs r
    JOIN sessions s ON s.session_id = r.session_id
    WHERE r.run_id = OLD.run_id AND s.removed = 1
  )
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
`;

/**
 * Open (creating if needed) the database file and bring its schema up to date. The file holds
 * whole conversations, including the contents of files the agent read, so a new file and its
 * folder are readable by the current user only.
 */
export function openDatabase(file: string): Db {
  const inMemory = file === ':memory:';
  if (!inMemory) mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  const db = new Database(file);
  if (!inMemory) chmodSync(file, 0o600);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `database schema version ${current} is newer than this program understands (${SCHEMA_VERSION}); ` +
        'refusing to open it so nothing is damaged',
    );
  }
  if (current < 1) {
    db.transaction(() => {
      db.exec(SCHEMA_V1);
      db.pragma('user_version = 1');
    })();
  }
  if (current < 2) {
    db.transaction(() => {
      db.exec(SCHEMA_V2);
      db.pragma('user_version = 2');
    })();
  }
}
