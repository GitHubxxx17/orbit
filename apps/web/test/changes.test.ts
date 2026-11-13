import { describe, expect, it } from 'vitest';

import { collectChanges } from '@/state/changes';
import { emptyRun, type RunView, type ToolCard } from '@/state/timeline';

const card = (over: Partial<ToolCard>): ToolCard => ({
  callId: 'c1',
  tool: 'write_file',
  args: { path: 'a.txt', content: 'x' },
  risk: 'write',
  status: 'awaiting',
  preview: '+x',
  ...over,
});
/** A call that was never shown to the user, so it has no preview. */
const unshown = (over: Partial<ToolCard>): ToolCard => {
  const { preview: _preview, ...rest } = card(over);
  return rest;
};
const turn = (...cards: ToolCard[]): RunView => ({
  ...emptyRun,
  tools: Object.fromEntries(cards.map((c) => [c.callId, c])),
});

describe('collectChanges', () => {
  it.each([
    ['awaiting', 'awaiting'],
    ['running', 'applying'],
    ['done', 'applied'],
    ['denied', 'rejected'],
    ['failed', 'failed'],
  ] as const)('maps a %s call to %s', (status, expected) => {
    expect(collectChanges([turn(card({ status }))])[0]?.status).toBe(expected);
  });

  it('ignores other tools and calls that were never put up for approval', () => {
    const changes = collectChanges([
      turn(
        unshown({ callId: 'r', tool: 'read_file', status: 'done' }),
        unshown({ callId: 'p', status: 'pending' }),
        card({ callId: 'w' }),
      ),
    ]);
    expect(changes.map((c) => c.key)).toEqual(['0:w']);
  });

  it('numbers turns from 1 and keeps them in order', () => {
    const changes = collectChanges([
      turn(card({ callId: 'a', status: 'done' })),
      turn(),
      turn(card({ callId: 'b', args: { path: 'b.txt' }, status: 'denied' })),
    ]);
    expect(changes.map((c) => [c.turn, c.path, c.status])).toEqual([
      [1, 'a.txt', 'applied'],
      [3, 'b.txt', 'rejected'],
    ]);
  });

  it('copes with a missing path', () => {
    expect(collectChanges([turn(card({ args: {} }))])[0]?.path).toBe('(未知路径)');
  });
});

describe('collectChanges: rollback', () => {
  const inRun = (...cards: ToolCard[]): RunView => ({ ...turn(...cards), runId: 'r1' });

  it('offers rollback only for a write that really happened', () => {
    const [applied, noRecord] = collectChanges([
      inRun(
        card({ callId: 'a', status: 'done', changed: true }),
        card({ callId: 'b', status: 'done' }),
      ),
    ]);
    expect(applied).toMatchObject({ canRollback: true, runId: 'r1', callId: 'a' });
    expect(noRecord?.canRollback).toBe(false);
  });

  it('shows an undone change as rolled back and no longer offers rollback', () => {
    const [change] = collectChanges([
      inRun(card({ status: 'done', changed: true, rolledBack: true })),
    ]);
    expect(change).toMatchObject({ status: 'rolledback', canRollback: false });
  });

  it('never offers rollback for a rejected write', () => {
    expect(collectChanges([inRun(card({ status: 'denied' }))])[0]?.canRollback).toBe(false);
  });
});
