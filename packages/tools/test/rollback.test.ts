import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FileChange } from '@orbit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollback, createTools, RollbackConflict } from '../src/index.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'orbit-rollback-'));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Run write_file the way the agent does and return what it reported as changed. */
async function write(file: string, content: string): Promise<FileChange> {
  const tool = (await createTools(workspace)).find((t) => t.name === 'write_file');
  if (!tool) throw new Error('write_file missing');
  const changes: FileChange[] = [];
  await tool.run(
    { path: file, content },
    { signal: new AbortController().signal, recordChange: (c) => changes.push(c) },
  );
  const [change] = changes;
  if (!change) throw new Error('no change was reported');
  return change;
}

const exists = (file: string) =>
  stat(path.join(workspace, file)).then(
    () => true,
    () => false,
  );

describe('write_file reports what it changed', () => {
  it('reports before as null for a new file', async () => {
    expect(await write('a.txt', 'new')).toEqual({ path: 'a.txt', before: null, after: 'new' });
  });

  it('reports the old text for an existing file', async () => {
    await writeFile(path.join(workspace, 'a.txt'), 'old');
    expect(await write('a.txt', 'new')).toEqual({ path: 'a.txt', before: 'old', after: 'new' });
  });
});

describe('rollback', () => {
  it('restores the previous text of an edited file', async () => {
    await writeFile(path.join(workspace, 'a.txt'), 'old');
    const change = await write('a.txt', 'new');

    await (
      await createRollback(workspace)
    )(change);

    expect(await readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe('old');
  });

  it('removes a file the agent created', async () => {
    const change = await write('dir/new.txt', 'hello');

    await (
      await createRollback(workspace)
    )(change);

    expect(await exists('dir/new.txt')).toBe(false);
  });

  it('refuses when the file was changed after the agent wrote it, and leaves it alone', async () => {
    await writeFile(path.join(workspace, 'a.txt'), 'old');
    const change = await write('a.txt', 'new');
    await writeFile(path.join(workspace, 'a.txt'), 'edited by the user');

    await expect((await createRollback(workspace))(change)).rejects.toBeInstanceOf(
      RollbackConflict,
    );
    expect(await readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe('edited by the user');
  });

  it('refuses when the file is already gone', async () => {
    const change = await write('a.txt', 'new');
    await rm(path.join(workspace, 'a.txt'));

    await expect((await createRollback(workspace))(change)).rejects.toBeInstanceOf(
      RollbackConflict,
    );
  });

  it('does not follow a stored path out of the workspace', async () => {
    const undo = await createRollback(workspace);
    await expect(undo({ path: '../escape.txt', before: null, after: 'x' })).rejects.toThrow(
      /outside the workspace/,
    );
    await expect(undo({ path: '.env', before: 'k', after: 'x' })).rejects.toThrow(/not allowed/);
  });
});
