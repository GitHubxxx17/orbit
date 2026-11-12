import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { emptySession, sessionReducer } from '@/state/session';

function event(runId: string, seq: number, draft: Record<string, unknown>): OrbitEvent {
  return { ...draft, id: `${runId}-${seq}`, runId, seq, ts: 0 } as OrbitEvent;
}

const started = (runId: string) =>
  event(runId, 1, { type: 'run.started', agentId: 'a', workspace: '/w' });
const asked = (runId: string, text: string) => event(runId, 2, { type: 'user.message', text });
const said = (runId: string, text: string) => event(runId, 3, { type: 'message.delta', text });

describe('sessionReducer', () => {
  it('shows the question at once, before any event has arrived', () => {
    const session = sessionReducer(emptySession, { type: 'new-turn', prompt: 'hello' });
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]).toMatchObject({ prompt: 'hello', status: 'idle', runId: null });
  });

  it('applies events to the newest turn only', () => {
    let session = sessionReducer(emptySession, { type: 'new-turn', prompt: 'one' });
    session = sessionReducer(session, {
      type: 'events',
      events: [started('r1'), asked('r1', 'one'), said('r1', 'first answer')],
    });
    session = sessionReducer(session, { type: 'new-turn', prompt: 'two' });
    session = sessionReducer(session, {
      type: 'events',
      events: [started('r2'), asked('r2', 'two'), said('r2', 'second answer')],
    });

    expect(session.turns.map((t) => t.prompt)).toEqual(['one', 'two']);
    expect(session.turns.map((t) => t.runId)).toEqual(['r1', 'r2']);
    expect(session.turns[0]?.items).toEqual([{ kind: 'text', id: 'r1-3', text: 'first answer' }]);
    expect(session.turns[1]?.items).toEqual([{ kind: 'text', id: 'r2-3', text: 'second answer' }]);
  });

  it('keeps earlier turns untouched while the newest one streams', () => {
    let session = sessionReducer(emptySession, { type: 'new-turn', prompt: 'one' });
    session = sessionReducer(session, { type: 'events', events: [started('r1'), said('r1', 'a')] });
    session = sessionReducer(session, { type: 'new-turn', prompt: 'two' });
    const before = session.turns[0];

    session = sessionReducer(session, { type: 'events', events: [started('r2')] });
    expect(session.turns[0]).toBe(before);
  });

  it('takes the question from the user.message event too', () => {
    let session = sessionReducer(emptySession, { type: 'new-turn', prompt: 'typed' });
    session = sessionReducer(session, {
      type: 'events',
      events: [started('r1'), asked('r1', 'typed')],
    });
    expect(session.turns[0]?.prompt).toBe('typed');
    expect(session.turns[0]?.rows.map((r) => r.label)).toEqual(['运行开始', '用户提问']);
  });

  it('drops a turn that could not be sent', () => {
    let session = sessionReducer(emptySession, { type: 'new-turn', prompt: 'one' });
    session = sessionReducer(session, { type: 'new-turn', prompt: 'two' });
    expect(sessionReducer(session, { type: 'drop-turn' }).turns.map((t) => t.prompt)).toEqual([
      'one',
    ]);
  });

  it('starts over on a new session', () => {
    const session = sessionReducer(emptySession, { type: 'new-turn', prompt: 'one' });
    expect(sessionReducer(session, { type: 'new-session' })).toBe(emptySession);
  });

  it('ignores events when there is no turn yet', () => {
    expect(sessionReducer(emptySession, { type: 'events', events: [started('r1')] })).toBe(
      emptySession,
    );
  });
});
