import type { Clock, SessionRecord, SessionStore } from '@orbit/core';

import type { Db } from './database.js';

interface SessionRow {
  session_id: string;
  created_at: number;
  title: string | null;
  removed: number;
}

/** Sessions in SQLite. Removing one hides it; its events stay in the append-only log. */
export class SqliteSessionStore implements SessionStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = { now: () => Date.now() },
  ) {}

  create(sessionId: string): SessionRecord {
    return this.db.transaction((): SessionRecord => {
      const existing = this.db
        .prepare('SELECT 1 FROM sessions WHERE session_id = ?')
        .get(sessionId);
      if (existing) throw new Error(`session id already used: ${sessionId}`);
      const createdAt = this.clock.now();
      this.db
        .prepare('INSERT INTO sessions (session_id, created_at) VALUES (?, ?)')
        .run(sessionId, createdAt);
      return { sessionId, createdAt, title: null, runIds: [] };
    })();
  }

  addRun(sessionId: string, runId: string): void {
    this.db.transaction(() => {
      const row = this.row(sessionId);
      if (!row || row.removed) throw new Error(`unknown session: ${sessionId}`);
      const used = this.db.prepare('SELECT 1 FROM session_runs WHERE run_id = ?').get(runId);
      if (used) throw new Error(`run already belongs to a session: ${runId}`);
      const { last } = this.db
        .prepare('SELECT COALESCE(MAX(position), 0) AS last FROM session_runs WHERE session_id = ?')
        .get(sessionId) as { last: number };
      this.db
        .prepare('INSERT INTO session_runs (run_id, session_id, position) VALUES (?, ?, ?)')
        .run(runId, sessionId, last + 1);
    })();
  }

  get(sessionId: string): SessionRecord | undefined {
    const row = this.row(sessionId);
    return row && !row.removed ? this.record(row) : undefined;
  }

  list(): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE removed = 0 ORDER BY created_at, rowid')
      .all() as SessionRow[];
    return rows.map((row) => this.record(row));
  }

  rename(sessionId: string, title: string | null): boolean {
    const result = this.db
      .prepare('UPDATE sessions SET title = ? WHERE session_id = ? AND removed = 0')
      .run(title, sessionId);
    return result.changes > 0;
  }

  remove(sessionId: string): boolean {
    const result = this.db
      .prepare('UPDATE sessions SET removed = 1 WHERE session_id = ? AND removed = 0')
      .run(sessionId);
    return result.changes > 0;
  }

  private row(sessionId: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
      SessionRow | undefined;
  }

  private record(row: SessionRow): SessionRecord {
    const runs = this.db
      .prepare('SELECT run_id FROM session_runs WHERE session_id = ? ORDER BY position')
      .all(row.session_id) as { run_id: string }[];
    return {
      sessionId: row.session_id,
      createdAt: row.created_at,
      title: row.title,
      runIds: runs.map((run) => run.run_id),
    };
  }
}
