import type { Clock } from './event-store.js';

/** One conversation: an ordered list of runs. The conversation itself lives in their event logs. */
export interface SessionRecord {
  sessionId: string;
  /** Unix epoch milliseconds. */
  createdAt: number;
  /** A title the user chose; null means "derive it from the first question". */
  title: string | null;
  /** Oldest first. */
  runIds: string[];
}

export interface SessionStore {
  /** Throws if the id was ever used, including by a session that has since been removed. */
  create(sessionId: string): SessionRecord;
  /** Throws for an unknown or removed session, or a run id that already belongs to a session. */
  addRun(sessionId: string, runId: string): void;
  /** Undefined for an unknown or removed session. */
  get(sessionId: string): SessionRecord | undefined;
  /** Sessions that have not been removed, oldest first. */
  list(): SessionRecord[];
  /** Set the title (null clears it). Returns false for an unknown or removed session. */
  rename(sessionId: string, title: string | null): boolean;
  /**
   * Hide a session. Its events are never deleted (the log is append-only); the session just stops
   * being listed or opened. Returns false for an unknown or already removed session.
   */
  remove(sessionId: string): boolean;
}

/** Sessions held in memory: lost on restart. Used in tests and as the no-database fallback. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord & { removed: boolean }>();
  private readonly usedRunIds = new Set<string>();

  constructor(private readonly clock: Clock = { now: () => Date.now() }) {}

  create(sessionId: string): SessionRecord {
    if (this.sessions.has(sessionId)) throw new Error(`session id already used: ${sessionId}`);
    const record = {
      sessionId,
      createdAt: this.clock.now(),
      title: null,
      runIds: [],
      removed: false,
    };
    this.sessions.set(sessionId, record);
    return this.copy(record);
  }

  addRun(sessionId: string, runId: string): void {
    const record = this.live(sessionId);
    if (!record) throw new Error(`unknown session: ${sessionId}`);
    if (this.usedRunIds.has(runId)) throw new Error(`run already belongs to a session: ${runId}`);
    this.usedRunIds.add(runId);
    record.runIds.push(runId);
  }

  get(sessionId: string): SessionRecord | undefined {
    const record = this.live(sessionId);
    return record ? this.copy(record) : undefined;
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()]
      .filter((record) => !record.removed)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((record) => this.copy(record));
  }

  rename(sessionId: string, title: string | null): boolean {
    const record = this.live(sessionId);
    if (!record) return false;
    record.title = title;
    return true;
  }

  remove(sessionId: string): boolean {
    const record = this.live(sessionId);
    if (!record) return false;
    record.removed = true;
    return true;
  }

  private live(sessionId: string) {
    const record = this.sessions.get(sessionId);
    return record && !record.removed ? record : undefined;
  }

  private copy({ sessionId, createdAt, title, runIds }: SessionRecord): SessionRecord {
    return { sessionId, createdAt, title, runIds: [...runIds] };
  }
}
