import type { Clock, EventDraft, EventStore, IdGenerator } from '@orbit/core';
import { OrbitEvent } from '@orbit/protocol';

import type { Db } from './database.js';

/** The event log in SQLite: append-only, `seq` assigned by the store, nothing kept in memory. */
export class SqliteEventStore implements EventStore {
  private readonly lastSeq;
  private readonly insert;
  private readonly select;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock = { now: () => Date.now() },
    private readonly ids: IdGenerator = { next: () => crypto.randomUUID() },
  ) {
    this.lastSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS last FROM events WHERE run_id = ?');
    this.insert = db.prepare(
      'INSERT INTO events (run_id, seq, id, ts, type, data) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.select = db.prepare('SELECT data FROM events WHERE run_id = ? AND seq > ? ORDER BY seq');
  }

  append(runId: string, draft: EventDraft): OrbitEvent {
    // One transaction, so reading the last number and writing the next cannot be interleaved.
    return this.db.transaction((): OrbitEvent => {
      const { last } = this.lastSeq.get(runId) as { last: number };
      // Parse before storing: a malformed event must never enter the log.
      const event = OrbitEvent.parse({
        ...draft,
        id: this.ids.next(),
        runId,
        seq: last + 1,
        ts: this.clock.now(),
      });
      this.insert.run(runId, event.seq, event.id, event.ts, event.type, JSON.stringify(event));
      return event;
    })();
  }

  /**
   * Delete whole runs. The database refuses unless every run belongs to an archived conversation
   * (ADR 0015), so this throws for a conversation that is in use.
   */
  deleteRuns(runIds: readonly string[]): void {
    const remove = this.db.prepare('DELETE FROM events WHERE run_id = ?');
    this.db.transaction(() => {
      for (const runId of runIds) remove.run(runId);
    })();
  }

  read(runId: string, afterSeq = 0): OrbitEvent[] {
    const rows = this.select.all(runId, afterSeq) as { data: string }[];
    return rows.map(({ data }, index) => {
      try {
        return OrbitEvent.parse(JSON.parse(data));
      } catch (error) {
        // A row the current schema cannot read must be loud, not silently skipped.
        throw new Error(
          `stored event ${index + 1} after #${afterSeq} of run ${runId} is unreadable`,
          {
            cause: error,
          },
        );
      }
    });
  }
}
