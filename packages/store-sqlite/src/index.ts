import type { Clock, IdGenerator } from '@orbit/core';

import { openDatabase, type Db } from './database.js';
import { SqliteEventStore } from './sqlite-event-store.js';
import { SqliteSessionStore } from './sqlite-session-store.js';

export { SCHEMA_VERSION, openDatabase, type Db } from './database.js';
export { SqliteEventStore } from './sqlite-event-store.js';
export { SqliteSessionStore } from './sqlite-session-store.js';

export interface Stores {
  events: SqliteEventStore;
  sessions: SqliteSessionStore;
  /** The underlying connection, for tests and maintenance. */
  db: Db;
  close(): void;
}

/** Open one database file and return the event store and session store that share it. */
export function openStores(
  file: string,
  options: { clock?: Clock; ids?: IdGenerator } = {},
): Stores {
  const db = openDatabase(file);
  return {
    events: new SqliteEventStore(db, options.clock, options.ids),
    sessions: new SqliteSessionStore(db, options.clock),
    db,
    close: () => db.close(),
  };
}
