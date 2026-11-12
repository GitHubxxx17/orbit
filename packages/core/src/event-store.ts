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
    return event;
  }

  read(runId: string, afterSeq = 0): OrbitEvent[] {
    return (this.runs.get(runId) ?? []).filter((e) => e.seq > afterSeq);
  }
}
