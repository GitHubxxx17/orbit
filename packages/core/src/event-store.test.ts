import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from './event-store.js';

function makeStore() {
  let id = 0;
  return new InMemoryEventStore({ now: () => 1000 }, { next: () => `e${(id += 1)}` });
}

describe('InMemoryEventStore', () => {
  it('assigns increasing seq per run', () => {
    const store = makeStore();
    const a = store.append('r1', { type: 'run.started', agentId: 'a', workspace: '/w' });
    const b = store.append('r1', { type: 'run.completed' });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a.runId).toBe('r1');
  });

  it('keeps runs independent', () => {
    const store = makeStore();
    store.append('r1', { type: 'run.completed' });
    const other = store.append('r2', { type: 'run.completed' });
    expect(other.seq).toBe(1);
  });

  it('reads only events after a given seq', () => {
    const store = makeStore();
    store.append('r1', { type: 'message.delta', text: 'a' });
    store.append('r1', { type: 'message.delta', text: 'b' });
    expect(store.read('r1', 1).map((e) => e.seq)).toEqual([2]);
  });

  it('rejects a malformed event and leaves the log unchanged', () => {
    const store = makeStore();
    const bad = { type: 'message.delta', text: 42 } as unknown as Parameters<
      typeof store.append
    >[1];
    expect(() => store.append('r1', bad)).toThrow();
    expect(store.read('r1')).toEqual([]);
  });

  it('returns an empty log for an unknown run', () => {
    expect(makeStore().read('missing')).toEqual([]);
  });
});
