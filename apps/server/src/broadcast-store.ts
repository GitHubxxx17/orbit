import type { EventDraft, EventStore } from '@orbit/core';
import type { OrbitEvent } from '@orbit/protocol';

export type EventListener = (event: OrbitEvent) => void;

/**
 * Wraps a store and tells subscribers about each appended event. The log stays the source of
 * truth: subscribers are only a way to avoid polling it.
 */
export class BroadcastingStore implements EventStore {
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(private readonly inner: EventStore) {}

  append(runId: string, draft: EventDraft): OrbitEvent {
    const event = this.inner.append(runId, draft);
    for (const listener of this.listeners.get(runId) ?? []) listener(event);
    return event;
  }

  read(runId: string, afterSeq?: number): OrbitEvent[] {
    return this.inner.read(runId, afterSeq);
  }

  deleteRuns(runIds: readonly string[]): void {
    this.inner.deleteRuns(runIds);
    for (const runId of runIds) this.listeners.delete(runId);
  }

  /** Returns a function that stops the subscription. */
  subscribe(runId: string, listener: EventListener): () => void {
    const set = this.listeners.get(runId) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }
}
