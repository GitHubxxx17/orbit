import { describe, expect, it } from 'vitest';

import {
  createPolicy,
  defaultPolicyConfig,
  globToRegExp,
  pathOf,
  readOnlyPolicy,
  type PolicyRequest,
} from '../../src/agent/policy.js';

const call = (over: Partial<PolicyRequest> = {}): PolicyRequest => ({
  tool: 'write_file',
  risk: 'write',
  args: { path: 'src/a.ts' },
  ...over,
});

describe('readOnlyPolicy', () => {
  it('allows reads and refuses everything else', () => {
    expect(readOnlyPolicy(call({ risk: 'read' }))).toBe('allow');
    expect(readOnlyPolicy(call({ risk: 'write' }))).toBe('deny');
    expect(readOnlyPolicy(call({ risk: 'dangerous' }))).toBe('deny');
  });
});

describe('globToRegExp', () => {
  it.each([
    ['docs/**', 'docs/a.md', true],
    ['docs/**', 'docs/x/y/a.md', true],
    ['docs/**', 'src/a.md', false],
    ['docs/*', 'docs/a.md', true],
    ['docs/*', 'docs/x/a.md', false],
    ['**/*.md', 'a.md', true],
    ['**/*.md', 'x/y/a.md', true],
    ['**/*.md', 'a.txt', false],
    ['a?c', 'abc', true],
    ['a?c', 'a/c', false],
    ['a.b', 'axb', false],
    ['src/(x)+.ts', 'src/(x)+.ts', true],
  ])('%s vs %s -> %s', (glob, target, expected) => {
    expect(globToRegExp(glob).test(target)).toBe(expected);
  });
});

describe('pathOf', () => {
  it('cleans the path and rejects anything that leaves the workspace', () => {
    expect(pathOf({ path: './docs//a.md' })).toBe('docs/a.md');
    expect(pathOf({ path: 'docs/../src/a.ts' })).toBe('src/a.ts');
    expect(pathOf({ path: 'docs\\a.md' })).toBe('docs/a.md');
    expect(pathOf({ path: '../x' })).toBeNull();
    expect(pathOf({ path: 'a/../../x' })).toBeNull();
    expect(pathOf({ path: '/etc/passwd' })).toBeNull();
    expect(pathOf({ path: 42 })).toBeNull();
    expect(pathOf({})).toBeNull();
  });
});

describe('createPolicy', () => {
  const policy = createPolicy(defaultPolicyConfig);

  it('allows reads, asks for writes, refuses the rest', () => {
    expect(policy(call({ tool: 'read_file', risk: 'read' }))).toBe('allow');
    expect(policy(call())).toBe('ask');
  });

  it('always refuses a dangerous call, even if a rule says allow', () => {
    const permissive = createPolicy({ rules: [{ id: 'all', action: 'allow' }] });
    expect(permissive(call({ risk: 'dangerous' }))).toBe('deny');
    expect(permissive(call())).toBe('allow');
  });

  it('uses the first rule that applies', () => {
    const p = createPolicy({
      rules: [
        { id: 'no-secrets', tools: ['write_file'], paths: ['secrets/**'], action: 'deny' },
        { id: 'docs-free', tools: ['write_file'], paths: ['docs/**'], action: 'allow' },
        { id: 'write-ask', risks: ['write'], action: 'ask' },
      ],
    });
    expect(p(call({ args: { path: 'secrets/key.txt' } }))).toBe('deny');
    expect(p(call({ args: { path: 'docs/a.md' } }))).toBe('allow');
    expect(p(call({ args: { path: 'src/a.ts' } }))).toBe('ask');
  });

  it('cannot be tricked into an allow by a path that only looks like it is in the folder', () => {
    const p = createPolicy({
      rules: [{ id: 'docs-free', paths: ['docs/**'], action: 'allow' }],
      fallback: 'ask',
    });
    expect(p(call({ args: { path: 'docs/../src/a.ts' } }))).toBe('ask');
    expect(p(call({ args: { path: '../docs/a.md' } }))).toBe('ask');
    expect(p(call({ args: { path: '/docs/a.md' } }))).toBe('ask');
  });

  it('does not apply a path rule to a call that has no path', () => {
    const p = createPolicy({ rules: [{ id: 'docs', paths: ['docs/**'], action: 'allow' }] });
    expect(p(call({ args: {} }))).toBe('deny');
  });

  it('falls back to deny unless told otherwise', () => {
    expect(createPolicy({ rules: [] })(call())).toBe('deny');
    expect(createPolicy({ rules: [], fallback: 'ask' })(call())).toBe('ask');
  });

  it('rejects a malformed configuration', () => {
    expect(() => createPolicy({ rules: [{ id: '', action: 'allow' }] })).toThrow();
    expect(() => createPolicy({ rules: [{ id: 'x', tools: [], action: 'allow' }] })).toThrow();
  });
});
