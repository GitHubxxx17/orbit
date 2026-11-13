import { OrbitEvent } from '@orbit/protocol';

/** Distributive omit so each union member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What callers supply; the store assigns id, runId, seq and ts. */
export type EventDraft = DistributiveOmit<OrbitEvent, 'id' | 'runId' | 'seq' | 'ts'>;

export interface EventStore {
  /** Append one event to a run's log and return it with id/seq/ts filled in. */
  append(runId: string, draft: EventDraft): OrbitEvent;
  /** Read a run's events in order, optionally starting after a given seq. */
  read(runId: string, afterSeq?: number): OrbitEvent[];
  /**
   * Delete whole runs. This is the only way events ever leave a store (ADR 0015), and it exists
   * for one thing: a conversation the user moved to the archive and then chose to delete for good.
   * Never partial, never a single event. A store that can enforce this must refuse for any run
   * whose conversation is not archived.
   */
  deleteRuns(runIds: readonly string[]): void;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  next(): string;
}

export class InMemoryEventStore implements EventStore {
  private readonly runs = new Map<string, OrbitEvent[]>();

  constructor(
    private readonly clock: Clock = { now: () => Date.now() },
    private readonly ids: IdGenerator = { next: () => crypto.randomUUID() },
  ) {}

  append(runId: string, draft: EventDraft): OrbitEvent {
    const log = this.runs.get(runId) ?? [];
    // Parse before storing: a malformed event must never enter the log.
    const event = OrbitEvent.parse({
      ...draft,
      id: this.ids.next(),
      runId,
      seq: log.length + 1,
      ts: this.clock.now(),
    });
    log.push(event);
    this.runs.set(runId, log);
    // Hand out a copy: a caller changing it must not change the log.
    return structuredClone(event);
  }

  read(runId: string, afterSeq = 0): OrbitEvent[] {
    return (this.runs.get(runId) ?? [])
      .filter((e) => e.seq > afterSeq)
      .map((e) => structuredClone(e));
  }

  deleteRuns(runIds: readonly string[]): void {
    for (const runId of runIds) this.runs.delete(runId);
  }
}
