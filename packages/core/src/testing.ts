/**
 * Contract tests that every store implementation must pass. Import them from `@orbit/core/testing`
 * in a test file; the in-memory stores run them in `@orbit/core`, the SQLite stores in
 * `@orbit/store-sqlite`. A new implementation is correct when it passes the same suite.
 */
import { describe, expect, it } from 'vitest';

import type { Clock, EventStore, IdGenerator } from './event-store.js';
import type { SessionStore } from './session-store.js';

export type EventStoreFactory = (clock: Clock, ids: IdGenerator) => EventStore;
export type SessionStoreFactory = (clock: Clock) => SessionStore;

function deterministic() {
  let n = 0;
  let now = 1000;
  return {
    clock: { now: () => now++ },
    ids: { next: () => `id${++n}` },
  };
}

export function eventStoreContract(name: string, create: EventStoreFactory): void {
  const fresh = () => {
    const { clock, ids } = deterministic();
    return create(clock, ids);
  };
  const started = { type: 'run.started', agentId: 'a', workspace: '/w' } as const;

  describe(`EventStore contract: ${name}`, () => {
    it('numbers events 1, 2, 3... separately for each run', () => {
      const store = fresh();
      store.append('r1', started);
      store.append('r1', { type: 'message.delta', text: 'hi' });
      store.append('r2', started);

      expect(store.read('r1').map((e) => e.seq)).toEqual([1, 2]);
      expect(store.read('r2').map((e) => e.seq)).toEqual([1]);
    });

    it('fills in id, run, sequence number and time itself', () => {
      const event = fresh().append('r1', started);
      expect(event).toMatchObject({
        id: 'id1',
        runId: 'r1',
        seq: 1,
        ts: 1000,
        type: 'run.started',
      });
    });

    it('returns exactly what was appended when read back, in order', () => {
      const store = fresh();
      const appended = [
        store.append('r1', started),
        store.append('r1', { type: 'user.message', text: '你好 "quoted" \n newline' }),
        store.append('r1', {
          type: 'tool.requested',
          callId: 'c1',
          tool: 'read_file',
          args: { path: 'a.ts', nested: { list: [1, 2, 3], flag: true, none: null } },
          risk: 'read',
        }),
      ];
      expect(store.read('r1')).toEqual(appended);
    });

    it('reads only events after a cursor', () => {
      const store = fresh();
      for (let i = 0; i < 4; i++) store.append('r1', { type: 'message.delta', text: String(i) });

      expect(store.read('r1', 2).map((e) => e.seq)).toEqual([3, 4]);
      expect(store.read('r1', 4)).toEqual([]);
      expect(store.read('r1', 99)).toEqual([]);
    });

    it('returns nothing for a run it has never seen', () => {
      expect(fresh().read('nope')).toEqual([]);
    });

    it('refuses an invalid event and leaves the log untouched', () => {
      const store = fresh();
      store.append('r1', started);
      const bad = { type: 'message.delta', text: 5 } as unknown as Parameters<
        EventStore['append']
      >[1];

      expect(() => store.append('r1', bad)).toThrow();
      expect(store.read('r1')).toHaveLength(1);
      // The next event still gets the next number: a refused event consumed nothing.
      expect(store.append('r1', { type: 'run.completed' }).seq).toBe(2);
    });

    it('keeps the log safe from changes to what it handed out', () => {
      const store = fresh();
      const event = store.append('r1', {
        type: 'tool.requested',
        callId: 'c1',
        tool: 't',
        args: { path: 'a' },
        risk: 'read',
      });
      (event as { args: Record<string, unknown> }).args['path'] = 'changed';
      const [read] = store.read('r1');
      (read as { args: Record<string, unknown> }).args['path'] = 'changed again';

      expect(store.read('r1')[0]).toMatchObject({ args: { path: 'a' } });
    });
  });
}

export function sessionStoreContract(name: string, create: SessionStoreFactory): void {
  const fresh = () => create(deterministic().clock);

  describe(`SessionStore contract: ${name}`, () => {
    it('creates a session with no runs, no title and the time it was made', () => {
      expect(fresh().create('s1')).toEqual({
        sessionId: 's1',
        createdAt: 1000,
        title: null,
        runIds: [],
      });
    });

    it('refuses to create the same id twice', () => {
      const store = fresh();
      store.create('s1');
      expect(() => store.create('s1')).toThrow();
    });

    it('keeps the runs of a session in the order they were added', () => {
      const store = fresh();
      store.create('s1');
      store.addRun('s1', 'r1');
      store.addRun('s1', 'r2');
      expect(store.get('s1')?.runIds).toEqual(['r1', 'r2']);
    });

    it('refuses a run for an unknown session, and a run that already has a session', () => {
      const store = fresh();
      store.create('s1');
      store.create('s2');
      store.addRun('s1', 'r1');

      expect(() => store.addRun('nope', 'r2')).toThrow();
      expect(() => store.addRun('s2', 'r1')).toThrow();
      expect(store.get('s2')?.runIds).toEqual([]);
    });

    it('returns undefined for an unknown session', () => {
      expect(fresh().get('nope')).toBeUndefined();
    });

    it('lists sessions oldest first', () => {
      const store = fresh();
      store.create('a');
      store.create('b');
      store.create('c');
      expect(store.list().map((s) => s.sessionId)).toEqual(['a', 'b', 'c']);
    });

    it('renames a session, and clears the title with null', () => {
      const store = fresh();
      store.create('s1');
      expect(store.rename('s1', '我的标题')).toBe(true);
      expect(store.get('s1')?.title).toBe('我的标题');
      expect(store.rename('s1', null)).toBe(true);
      expect(store.get('s1')?.title).toBeNull();
      expect(store.rename('nope', 'x')).toBe(false);
    });

    it('hides a removed session but never lets its id or its runs be reused', () => {
      const store = fresh();
      store.create('s1');
      store.addRun('s1', 'r1');

      expect(store.remove('s1')).toBe(true);
      expect(store.get('s1')).toBeUndefined();
      expect(store.list()).toEqual([]);
      expect(store.remove('s1')).toBe(false);
      expect(store.rename('s1', 'x')).toBe(false);
      expect(() => store.create('s1')).toThrow();
      expect(() => store.addRun('s1', 'r9')).toThrow();
    });

    it('keeps the record safe from changes to what it handed out', () => {
      const store = fresh();
      store.create('s1');
      store.addRun('s1', 'r1');
      store.get('s1')?.runIds.push('hacked');
      store.list()[0]?.runIds.push('hacked');
      expect(store.get('s1')?.runIds).toEqual(['r1']);
    });
  });
}
