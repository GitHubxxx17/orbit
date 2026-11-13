import { describe, expect, it } from 'vitest';

import { compare, parseSuite } from '../src/compare.js';
import { categoryRates, formatComparison, formatSuite } from '../src/format.js';
import type { CaseSummary, SuiteResult } from '../src/runner.js';

const summary = (
  id: string,
  passRate: number | null,
  over: Partial<CaseSummary> = {},
): CaseSummary => ({
  id,
  category: id.startsWith('inject') ? 'injection' : 'task',
  runs: 4,
  passes: passRate === null ? 0 : Math.round(passRate * 4),
  fails: passRate === null ? 0 : 4 - Math.round(passRate * 4),
  errors: passRate === null ? 4 : 0,
  passRate,
  failures: [],
  ...over,
});

const suite = (cases: CaseSummary[], over: Partial<SuiteResult> = {}): SuiteResult => ({
  schemaVersion: 1,
  createdAt: '2026-11-13T00:00:00.000Z',
  model: 'm',
  promptHash: 'aaaaaaaaaaaa',
  repeat: 4,
  cases,
  ...over,
});

describe('compare', () => {
  it('flags a case whose pass rate dropped as a regression', () => {
    const result = compare(
      suite([summary('inject-a', 1), summary('task-b', 0.5)]),
      suite([summary('inject-a', 0.5), summary('task-b', 0.5)]),
    );
    expect(result.regressions).toEqual([
      { id: 'inject-a', category: 'injection', before: 1, after: 0.5 },
    ]);
    expect(result.unchanged).toEqual(['task-b']);
  });

  it('reports an improvement', () => {
    const result = compare(suite([summary('task-b', 0.25)]), suite([summary('task-b', 1)]));
    expect(result.improvements).toHaveLength(1);
    expect(result.regressions).toEqual([]);
  });

  it('lets a model vary within the tolerance', () => {
    const before = suite([summary('task-b', 1)]);
    const after = suite([summary('task-b', 0.75)]);
    expect(compare(before, after, 0).regressions).toHaveLength(1);
    expect(compare(before, after, 0.25).regressions).toEqual([]);
    expect(compare(before, after, 0.25).unchanged).toEqual(['task-b']);
  });

  it('keeps cases that are missing, new, or not comparable apart', () => {
    const result = compare(
      suite([summary('task-gone', 1), summary('task-err', 1), summary('task-same', 1)]),
      suite([summary('task-new', 1), summary('task-err', null), summary('task-same', 1)]),
    );
    expect(result.missing).toEqual(['task-gone']);
    expect(result.added).toEqual(['task-new']);
    expect(result.notComparable).toEqual(['task-err']);
    expect(result.regressions).toEqual([]);
  });

  it('says when the prompt or model differs, since the numbers then answer a different question', () => {
    const result = compare(
      suite([summary('task-b', 1)]),
      suite([summary('task-b', 1)], { promptHash: 'bbbbbbbbbbbb', model: 'other' }),
    );
    expect(result).toMatchObject({ promptChanged: true, modelChanged: true });
    expect(formatComparison(result)).toContain('system prompt differs');
  });
});

describe('parseSuite', () => {
  it('reads back what was saved', () => {
    const original = suite([summary('task-b', 0.5, { failures: ['x'] })]);
    expect(parseSuite(JSON.stringify(original))).toEqual(original);
  });

  it.each([
    ['text that is not JSON', '{ nope'],
    ['another version', JSON.stringify({ ...suite([]), schemaVersion: 2 })],
    ['a pass rate above 1', JSON.stringify(suite([summary('task-b', 1, { passRate: 1.5 })]))],
    ['a missing field', JSON.stringify({ schemaVersion: 1, cases: [] })],
  ])('rejects %s', (_label, text) => {
    expect(() => parseSuite(text)).toThrow();
  });
});

describe('formatting', () => {
  const result = suite([
    summary('task-a', 1),
    summary('inject-a', 0.5, { failures: ['tool-not-called write_file: called 1 time(s)'] }),
    summary('inject-b', null),
  ]);

  it('averages the pass rate per category', () => {
    expect(categoryRates(result.cases)).toEqual({ task: 1, injection: 0.5 });
  });

  it('lists each case with its failures and the category rates', () => {
    const text = formatSuite(result);
    expect(text).toContain('inject-a');
    expect(text).toContain('- tool-not-called write_file');
    expect(text).toContain('pass rate by category: task 100%, injection 50%');
    expect(text).toContain('n/a');
  });

  it('says plainly when there is no regression', () => {
    expect(formatComparison(compare(result, result))).toContain('no regressions');
  });
});
