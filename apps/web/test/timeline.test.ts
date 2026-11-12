import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { applyEvent, applyEvents, emptyRun } from '@/state/timeline';

type Draft = OrbitEvent extends infer E
  ? E extends unknown
    ? Omit<E, 'id' | 'runId' | 'seq' | 'ts'>
    : never
  : never;

/** Build a well-formed log from drafts, numbering seq from 1. */
function log(...drafts: Draft[]): OrbitEvent[] {
  return drafts.map((draft, index) => ({
    ...draft,
    id: `e${index + 1}`,
    runId: 'r1',
    seq: index + 1,
    ts: 0,
  })) as OrbitEvent[];
}

const started: Draft = { type: 'run.started', agentId: 'a', workspace: '/w' };
const delta = (text: string): Draft => ({ type: 'message.delta', text });
const requested: Draft = {
  type: 'tool.requested',
  callId: 'c1',
  tool: 'list_dir',
  args: {},
  risk: 'read',
};

describe('applyEvents', () => {
  it('joins consecutive text deltas into one text item', () => {
    const view = applyEvents(emptyRun, log(started, delta('he'), delta('llo')));
    expect(view.status).toBe('running');
    expect(view.items).toEqual([{ kind: 'text', id: 'e2', text: 'hello' }]);
  });

  it('folds consecutive deltas into one timeline row with a count', () => {
    const view = applyEvents(emptyRun, log(started, delta('a'), delta('b'), delta('c')));
    expect(view.rows.map((r) => [r.type, r.count])).toEqual([
      ['run.started', 1],
      ['message.delta', 3],
    ]);
  });

  it('walks a tool card through running to done', () => {
    const events = log(
      started,
      requested,
      { type: 'tool.decided', callId: 'c1', decision: 'allow', by: 'policy' },
      { type: 'tool.result', callId: 'c1', ok: true, output: 'dir src' },
    );
    const status = (n: number) => applyEvents(emptyRun, events.slice(0, n)).tools['c1']?.status;
    expect([status(2), status(3), status(4)]).toEqual(['pending', 'running', 'done']);
    expect(applyEvents(emptyRun, events).tools['c1']?.output).toBe('dir src');
  });

  it('marks a denied call as denied and never shows a result', () => {
    const view = applyEvents(
      emptyRun,
      log(started, requested, {
        type: 'tool.decided',
        callId: 'c1',
        decision: 'deny',
        by: 'policy',
      }),
    );
    expect(view.tools['c1']).toMatchObject({ status: 'denied', decidedBy: 'policy' });
  });

  it('marks a failed tool result as failed', () => {
    const view = applyEvents(
      emptyRun,
      log(
        started,
        requested,
        { type: 'tool.decided', callId: 'c1', decision: 'allow', by: 'policy' },
        { type: 'tool.result', callId: 'c1', ok: false, output: 'Error: nope' },
      ),
    );
    expect(view.tools['c1']?.status).toBe('failed');
  });

  it('keeps text and tool cards in the order they happened', () => {
    const view = applyEvents(emptyRun, log(started, delta('one'), requested, delta('two')));
    expect(view.items.map((i) => i.kind)).toEqual(['text', 'tool', 'text']);
  });

  it('records the final status and failure reason', () => {
    expect(applyEvents(emptyRun, log(started, { type: 'run.completed' })).status).toBe('completed');
    const failed = applyEvents(emptyRun, log(started, { type: 'run.failed', reason: 'cancelled' }));
    expect([failed.status, failed.failReason]).toEqual(['failed', 'cancelled']);
  });

  it('ignores events it has already applied (reconnect replay)', () => {
    const events = log(started, delta('a'), delta('b'));
    const once = applyEvents(emptyRun, events);
    expect(applyEvents(once, events)).toBe(once);
    expect(applyEvents(once, events).items).toEqual([{ kind: 'text', id: 'e2', text: 'ab' }]);
  });

  it('keeps earlier items untouched while a delta streams in', () => {
    const before = applyEvents(emptyRun, log(started, delta('a'), requested));
    const after = applyEvent(before, {
      ...log(started, delta('a'), requested, delta('b'))[3]!,
    });
    expect(after.items[0]).toBe(before.items[0]);
    expect(after.items[1]).toBe(before.items[1]);
  });

  it('gives the same view when replayed from scratch as when applied incrementally', () => {
    const events = log(started, delta('x'), requested, delta('y'), { type: 'run.completed' });
    const incremental = events.reduce(applyEvent, emptyRun);
    expect(applyEvents(emptyRun, events)).toEqual(incremental);
  });
});
