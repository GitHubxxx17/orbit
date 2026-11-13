import { EARLY_STOP_PREFIX, type OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { formatTokens } from '@/lib/format';
import { turnFooter } from '@/state/footer';
import { applyEvents, cacheShare, emptyRun, type RunView } from '@/state/timeline';

let seq = 0;
const ev = (draft: Record<string, unknown>, ts = 1000) =>
  ({ ...draft, id: `e${++seq}`, runId: 'r', seq, ts }) as OrbitEvent;

/** A finished run with the given usage events between start and end. */
function run(options: {
  agent?: string;
  agentName?: string;
  usage?: ([number, number] | [number, number, number])[];
  end?: 'ok' | 'early' | 'error';
}) {
  seq = 0;
  const end = options.end ?? 'ok';
  return applyEvents(emptyRun, [
    ev(
      {
        type: 'run.started',
        agentId: options.agent ?? 'orbit-default',
        workspace: '/w',
        ...(options.agentName ? { agentName: options.agentName } : {}),
      },
      1000,
    ),
    ev({ type: 'user.message', text: 'q' }),
    ...(options.usage ?? []).map(([promptTokens, completionTokens, cachedTokens]) =>
      ev({
        type: 'model.usage',
        promptTokens,
        completionTokens,
        ...(cachedTokens === undefined ? {} : { cachedTokens }),
      }),
    ),
    end === 'ok'
      ? ev({ type: 'run.completed' }, 28_000)
      : ev(
          {
            type: 'run.failed',
            reason: end === 'early' ? `${EARLY_STOP_PREFIX}loop` : 'model error',
          },
          28_000,
        ),
  ]);
}

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [812, '812'],
    [999, '999'],
    [1000, '1.0k'],
    [12_345, '12.3k'],
    [9_949, '9.9k'],
    [9_950, '10.0k'],
    [99_999, '100.0k'],
    [999_949, '999.9k'],
    [999_950, '1.0M'],
    [1_200_000, '1.2M'],
  ])('shows %i as %s', (count, text) => {
    expect(formatTokens(count)).toBe(text);
  });
});

describe('usage in a turn view', () => {
  it('adds up the model calls of one turn', () => {
    const view = run({
      usage: [
        [100, 10],
        [150, 20],
      ],
    });
    expect(view.usage).toMatchObject({ promptTokens: 250, completionTokens: 30, calls: 2 });
  });

  it('remembers the size of the newest request, which is how full the window is now', () => {
    const view = run({
      usage: [
        [100, 10],
        [180, 20],
        [260, 5],
      ],
    });
    expect(view.usage?.lastPromptTokens).toBe(260);
  });

  it('adds up cache hits, but only calls them known when every call said so', () => {
    const known = run({
      usage: [
        [100, 10, 0],
        [200, 20, 150],
      ],
    });
    expect(known.usage).toMatchObject({ cachedTokens: 150, cachedCalls: 2 });
    expect(cacheShare(known.usage!)).toBe(50);

    const partial = run({
      usage: [
        [100, 10, 80],
        [200, 20],
      ],
    });
    expect(cacheShare(partial.usage!)).toBeNull(); // one call did not say: unknown, not a guess

    const none = run({ usage: [[100, 10]] });
    expect(cacheShare(none.usage!)).toBeNull();
  });

  it('keeps a real 0% hit rate apart from an unknown one', () => {
    const zero = run({ usage: [[100, 10, 0]] });
    expect(cacheShare(zero.usage!)).toBe(0);
  });

  it('shows the cache hit rate in the line under the turn only when it is known', () => {
    expect(turnFooter(run({ usage: [[1000, 50, 800]] }), 'm')).toContain('缓存命中 80%');
    expect(turnFooter(run({ usage: [[1000, 50]] }), 'm')).not.toContain('缓存');
  });

  it('stays null when nothing was reported, which is not the same as zero', () => {
    expect(run({}).usage).toBeNull();
    expect(emptyRun.usage).toBeNull();
  });

  it('shows the event on the timeline with readable numbers', () => {
    const row = run({ usage: [[12_345, 85]] }).rows.find((r) => r.type === 'model.usage');
    expect(row?.label).toBe('用量 输入 12.3k · 输出 85');
  });
});

describe('turnFooter', () => {
  it('shows model, time and tokens for a finished run', () => {
    expect(turnFooter(run({ usage: [[12_345, 85]] }), 'deepseek-flash')).toBe(
      'deepseek-flash · 用时 27 秒 · 输入 12.3k · 输出 85 token',
    );
  });

  it('names the agent profile before the model when the run used one', () => {
    expect(turnFooter(run({ agentName: 'Reviewer', usage: [[1, 1]] }), 'deepseek-flash')).toMatch(
      /^Reviewer · deepseek-flash · /,
    );
  });

  it('says how many calls it took when there were several', () => {
    expect(
      turnFooter(
        run({
          usage: [
            [100, 10],
            [150, 20],
          ],
        }),
        'm',
      ),
    ).toContain('输入 250 · 输出 30 token · 2 次模型调用');
  });

  it('says the usage is unknown for a real model that did not report it, never 0', () => {
    const line = turnFooter(run({}), 'deepseek-flash');
    expect(line).toBe('deepseek-flash · 用时 27 秒 · 用量未知');
    expect(line).not.toContain('0 token');
  });

  it('says nothing about usage for the demo model, which reports none by design', () => {
    expect(turnFooter(run({ agent: 'orbit-demo' }), null)).toBe('演示模型 · 用时 27 秒');
  });

  it('is also shown for a run Orbit ended early, since it still cost something', () => {
    expect(turnFooter(run({ end: 'early', usage: [[500, 50]] }), 'm')).toContain('输入 500');
  });

  it('is not shown for a failure, a run still going, or an empty turn', () => {
    expect(turnFooter(run({ end: 'error', usage: [[1, 1]] }), 'm')).toBeNull();
    const running: RunView = { ...run({}), status: 'running' };
    expect(turnFooter(running, 'm')).toBeNull();
    expect(turnFooter(emptyRun, 'm')).toBeNull();
  });
});
