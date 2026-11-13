import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { replayAt, replaySteps } from '@/state/replay';
import { applyEvents, emptyRun } from '@/state/timeline';

let n = 0;
/** An event with a correct seq for its position in a run. */
function run(runId: string, ...drafts: Record<string, unknown>[]): OrbitEvent[] {
  return drafts.map(
    (d, i) => ({ ...d, id: `e${++n}`, runId, seq: i + 1, ts: 1000 + i }) as OrbitEvent,
  );
}

const start = { type: 'run.started', agentId: 'a', workspace: '/w' };
const ask = (text: string) => ({ type: 'user.message', text });
const say = (text: string) => ({ type: 'message.delta', text });
const done = { type: 'run.completed' };

const first = () => run('r1', start, ask('q1'), say('he'), say('llo'), done);
const second = () => run('r2', start, ask('q2'), say('bye'), done);

describe('replaySteps', () => {
  it('makes a burst of streamed text a single stop', () => {
    const steps = replaySteps([first()]);
    expect(steps.map((s) => s.label)).toEqual(['运行开始', '用户提问', '模型输出', '运行完成']);
    // The stop for the text is after its LAST delta, so the screen shows the whole burst.
    expect(steps.map((s) => s.position)).toEqual([1, 2, 4, 5]);
  });

  it('counts positions across runs and remembers which turn a stop belongs to', () => {
    const steps = replaySteps([first(), second()]);
    expect(steps.at(-1)).toMatchObject({ position: 9, turn: 1 });
    expect(steps.filter((s) => s.turn === 0)).toHaveLength(4);
  });

  it('has no stops for an empty conversation', () => {
    expect(replaySteps([])).toEqual([]);
  });
});

describe('replayAt', () => {
  it('shows nothing at position 0', () => {
    expect(replayAt([first()], 0).turns).toEqual([]);
  });

  it('shows a run partway through, as the live view would have at that moment', () => {
    const log = first();
    const at = replayAt([log], 3).turns[0];
    expect(at?.status).toBe('running');
    expect(at?.items).toEqual([{ kind: 'text', id: log[2]?.id, text: 'he' }]);
  });

  it('is exactly the live fold of the same prefix', () => {
    const logs = [first(), second()];
    const view = replayAt(logs, 7);
    expect(view.turns[0]).toEqual(applyEvents(emptyRun, logs[0] ?? []));
    expect(view.turns[1]).toEqual(applyEvents(emptyRun, (logs[1] ?? []).slice(0, 2)));
  });

  it('does not show a later run before it begins', () => {
    expect(replayAt([first(), second()], 5).turns).toHaveLength(1);
    expect(replayAt([first(), second()], 6).turns).toHaveLength(2);
  });

  it('clamps a position past the end and below zero', () => {
    expect(replayAt([first()], 99).turns[0]?.status).toBe('completed');
    expect(replayAt([first()], -3).turns).toEqual([]);
  });
});
