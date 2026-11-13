import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CaseError, loadCases, parseCase } from '../src/case.js';
import { selfCheck } from '../src/self-check.js';

const casesDir = fileURLToPath(new URL('../cases', import.meta.url));
const cases = loadCases(casesDir);

describe('the shipped cases', () => {
  it('load, with unique ids and every category present', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.category))).toEqual(new Set(['task', 'injection', 'report']));
  });

  it('are each accepted with a good script and rejected with a bad one', async () => {
    // If this fails, a check does not tell good from bad behaviour, so no real result can be trusted.
    expect(await selfCheck(cases)).toEqual([]);
  }, 60_000);

  it('give every injection case a way to fail: no write and no leak', () => {
    for (const item of cases.filter((c) => c.category === 'injection')) {
      const types = item.checks.map((c) => c.type);
      expect(types, item.id).toContain('run-completed');
      expect(
        types.includes('tool-not-called') ||
          types.includes('no-leak') ||
          types.includes('report-excludes'),
        item.id,
      ).toBe(true);
      // The task must still be done: refusing everything is not a pass.
      expect(
        types.includes('answer-includes') || types.includes('report-made'),
        `${item.id} must also check the task was done`,
      ).toBe(true);
    }
  });

  it('plant every canary it checks for, so a clean result means something', () => {
    for (const item of cases) {
      for (const check of item.checks) {
        if (check.type !== 'no-leak') continue;
        const planted = Object.values(item.files).some((content) => content.includes(check.text));
        expect(planted, `${item.id}: ${check.text} is not in the fixture`).toBe(true);
      }
    }
  });

  it('use made-up secrets only', () => {
    const everything = JSON.stringify(cases);
    expect(everything).not.toMatch(/sk-[a-z0-9]{20,}/i);
    expect(everything).not.toMatch(/BEGIN (RSA|OPENSSH|PRIVATE)/);
  });
});

describe('parseCase', () => {
  const base = {
    id: 'x',
    category: 'task',
    description: 'd',
    files: {},
    prompt: 'p',
    checks: [{ type: 'run-completed' }],
  };
  const parse = (value: unknown) => parseCase(JSON.stringify(value), 'x.json');

  it('accepts a minimal case', () => {
    expect(parse(base).id).toBe('x');
  });

  it.each([
    ['an id with capitals', { ...base, id: 'Bad Id' }],
    ['an unknown category', { ...base, category: 'other' }],
    ['no checks', { ...base, checks: [] }],
    ['an unknown check', { ...base, checks: [{ type: 'nope' }] }],
    ['a path that leaves the workspace', { ...base, files: { '../escape.txt': 'x' } }],
    ['an absolute path', { ...base, files: { '/etc/passwd': 'x' } }],
    [
      'a check on a path that leaves the workspace',
      { ...base, checks: [{ type: 'file-absent', path: '../x' }] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parse(value)).toThrow(CaseError);
  });

  it('rejects text that is not JSON, naming the file', () => {
    expect(() => parseCase('{ nope', 'bad.json')).toThrow('bad.json: not valid JSON');
  });
});
