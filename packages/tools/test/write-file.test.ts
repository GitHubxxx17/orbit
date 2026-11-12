import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Tool } from '@orbit/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTools } from '../src/index.js';

let base: string;
let workspace: string;
let outside: string;
let write: Tool;

const ctx = { signal: new AbortController().signal };
const preview = (args: unknown) => {
  if (!write.preview) throw new Error('write_file has no preview');
  return write.preview(args, ctx);
};
const run = (args: unknown) => write.run(args, ctx);
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'orbit-write-'));
  workspace = path.join(base, 'ws');
  outside = path.join(base, 'outside');
  await mkdir(path.join(workspace, 'src'), { recursive: true });
  await mkdir(path.join(workspace, '.git'));
  await mkdir(outside);

  await writeFile(path.join(workspace, 'src/a.ts'), 'one\ntwo\nthree\n');
  await writeFile(path.join(workspace, 'bin.dat'), Buffer.from([1, 0, 2]));
  await symlink(outside, path.join(workspace, 'escape'));
  await symlink(path.join(outside, 'target.txt'), path.join(workspace, 'dangling.txt'));
  await writeFile(path.join(outside, 'real.txt'), 'outside');
  await symlink(path.join(outside, 'real.txt'), path.join(workspace, 'link.txt'));

  const tool = (await createTools(workspace)).find((t) => t.name === 'write_file');
  if (!tool) throw new Error('write_file missing');
  write = tool;
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('write_file preview', () => {
  it('shows a new file as additions and does not create it', async () => {
    const diff = await preview({ path: 'src/new.ts', content: 'hello\n' });
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ b/src/new.ts');
    expect(diff).toContain('+hello');
    expect(await exists(path.join(workspace, 'src/new.ts'))).toBe(false);
  });

  it('shows changes to an existing file and leaves it untouched', async () => {
    const diff = await preview({ path: 'src/a.ts', content: 'one\n2\nthree\n' });
    expect(diff).toContain('--- a/src/a.ts');
    expect(diff).toContain('-two');
    expect(diff).toContain('+2');
    expect(await readFile(path.join(workspace, 'src/a.ts'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('says so when nothing would change', async () => {
    expect(await preview({ path: 'src/a.ts', content: 'one\ntwo\nthree\n' })).toBe('(没有变化)');
  });

  it('refuses unusable arguments', async () => {
    await expect(preview({ path: 1, content: 'x' })).rejects.toThrow();
    await expect(preview({ path: 'x' })).rejects.toThrow();
  });
});

describe('write_file', () => {
  it('creates missing folders and the file, then updates it', async () => {
    expect(await run({ path: 'deep/er/note.txt', content: 'hi' })).toBe(
      'created deep/er/note.txt (2 bytes)',
    );
    expect(await readFile(path.join(workspace, 'deep/er/note.txt'), 'utf8')).toBe('hi');

    expect(await run({ path: 'deep/er/note.txt', content: 'hello' })).toBe(
      'updated deep/er/note.txt (5 bytes)',
    );
  });

  it.each([
    ['../escape.txt', 'outside the workspace'],
    ['escape/new.txt', 'outside the workspace'],
    ['link.txt', 'outside the workspace'],
    ['dangling.txt', 'symbolic link'],
    ['.env', 'not allowed'],
    ['.git/config', 'not allowed'],
    ['node_modules/pkg/index.js', 'not allowed'],
    ['.', 'not a file'],
    ['src', 'not a file'],
    ['bin.dat', 'binary'],
  ])('refuses %s', async (target, message) => {
    await expect(run({ path: target, content: 'x' })).rejects.toThrow(message);
    await expect(preview({ path: target, content: 'x' })).rejects.toThrow(message);
  });

  it('writes nothing outside the workspace', async () => {
    await run({ path: 'dangling.txt', content: 'x' }).catch(() => undefined);
    await run({ path: 'link.txt', content: 'x' }).catch(() => undefined);
    expect(await exists(path.join(outside, 'target.txt'))).toBe(false);
    expect(await readFile(path.join(outside, 'real.txt'), 'utf8')).toBe('outside');
  });

  it('refuses content over the size limit', async () => {
    await expect(run({ path: 'big.txt', content: 'x'.repeat(200_001) })).rejects.toThrow();
  });

  it('is a write-risk tool, so a policy decides whether it runs', () => {
    expect(write.risk).toBe('write');
  });
});
