import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ToolRegistry, type Tool } from '@orbit/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createReadOnlyTools, Sandbox } from '../src/index.js';
import { MAX_BATCH_CHARS, MAX_BATCH_FILES } from '../src/read-files.js';

let base: string;
let workspace: string;
let outside: string;
let tools: Record<string, Tool>;

const ctx = { signal: new AbortController().signal };
const run = (name: string, args: unknown) => {
  const tool = tools[name];
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.run(args, ctx);
};

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'orbit-tools-'));
  workspace = path.join(base, 'ws');
  outside = path.join(base, 'outside');
  await mkdir(path.join(workspace, 'src'), { recursive: true });
  await mkdir(path.join(workspace, 'node_modules/pkg'), { recursive: true });
  await mkdir(path.join(workspace, '.git'), { recursive: true });
  await mkdir(outside);

  await writeFile(path.join(workspace, 'src/a.ts'), 'const alpha = 1;\nconst Beta = 2;\n');
  await writeFile(path.join(workspace, 'src/b.ts'), 'export const gamma = alpha;\n');
  await writeFile(path.join(workspace, 'README.md'), '# hello\n');
  await writeFile(path.join(workspace, '.env'), 'TOKEN=super-secret\n');
  await writeFile(path.join(workspace, '.env.example'), 'TOKEN=\n');
  await writeFile(path.join(workspace, '.git/config'), 'url = https://x:secret@host\n');
  await writeFile(path.join(workspace, 'node_modules/pkg/index.js'), 'alpha');
  await writeFile(path.join(workspace, 'image.bin'), Buffer.from([1, 2, 0, 3]));
  await writeFile(
    path.join(workspace, 'long.txt'),
    Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'),
  );
  await writeFile(path.join(outside, 'secret.txt'), 'outside secret');
  await symlink(outside, path.join(workspace, 'escape'));
  await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'link.txt'));

  tools = Object.fromEntries((await createReadOnlyTools(workspace)).map((t) => [t.name, t]));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('Sandbox', () => {
  it('rejects paths that leave the workspace', async () => {
    const sandbox = await Sandbox.create(workspace);
    await expect(sandbox.resolve('../outside/secret.txt')).rejects.toThrow('outside the workspace');
    await expect(sandbox.resolve(path.join(outside, 'secret.txt'))).rejects.toThrow('outside');
    await expect(sandbox.resolve('src\0/a.ts')).rejects.toThrow('NUL');
  });

  it('rejects symlinks that point outside the workspace', async () => {
    const sandbox = await Sandbox.create(workspace);
    await expect(sandbox.resolve('escape/secret.txt')).rejects.toThrow('outside the workspace');
    await expect(sandbox.resolve('link.txt')).rejects.toThrow('outside the workspace');
  });

  it('rejects credential files and ignored directories but allows .env.example', async () => {
    const sandbox = await Sandbox.create(workspace);
    await expect(sandbox.resolve('.env')).rejects.toThrow('not allowed');
    await expect(sandbox.resolve('.git/config')).rejects.toThrow('not allowed');
    await expect(sandbox.resolve('.env.example')).resolves.toContain('.env.example');
  });
});

describe('list_dir', () => {
  it('lists entries and hides noise and secrets', async () => {
    const out = await run('list_dir', {});
    expect(out).toContain('dir  src');
    expect(out).toContain('file README.md');
    expect(out).toContain('file .env.example');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('.git\n');
    expect(out).not.toMatch(/\.env$/m);
  });

  it('refuses a file and an escaping path', async () => {
    await expect(run('list_dir', { path: 'README.md' })).rejects.toThrow('not a directory');
    await expect(run('list_dir', { path: '..' })).rejects.toThrow('outside the workspace');
  });
});

describe('read_file', () => {
  it('returns numbered lines', async () => {
    await expect(run('read_file', { path: 'src/a.ts' })).resolves.toBe(
      '1\tconst alpha = 1;\n2\tconst Beta = 2;',
    );
  });

  it('pages with offset and limit and says how to continue', async () => {
    const out = await run('read_file', { path: 'long.txt', offset: 3, limit: 2 });
    expect(out).toBe('3\tline 3\n4\tline 4\n[showing lines 3-4 of 10; call again with offset=5]');
  });

  it('refuses secrets, binary files, and offsets past the end', async () => {
    await expect(run('read_file', { path: '.env' })).rejects.toThrow('not allowed');
    await expect(run('read_file', { path: 'image.bin' })).rejects.toThrow('binary');
    await expect(run('read_file', { path: 'long.txt', offset: 99 })).rejects.toThrow(
      'past the end',
    );
    await expect(run('read_file', { path: 'missing.txt' })).rejects.toThrow('no such file');
  });
});

describe('read_files', () => {
  it('reads several files in one call, each under its own heading', async () => {
    const out = await run('read_files', { files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] });
    expect(out).toBe(
      '=== src/a.ts ===\n1\tconst alpha = 1;\n2\tconst Beta = 2;\n\n' +
        '=== src/b.ts ===\n1\texport const gamma = alpha;',
    );
  });

  it('pages each file on its own', async () => {
    const out = await run('read_files', {
      files: [{ path: 'long.txt', offset: 3, limit: 2 }, { path: 'README.md' }],
    });
    expect(out).toContain('=== long.txt ===\n3\tline 3\n4\tline 4\n[showing lines 3-4 of 10');
    expect(out).toContain('=== README.md ===\n1\t# hello');
  });

  it('reports a file it cannot read in its place and still reads the others', async () => {
    const out = await run('read_files', {
      files: [
        { path: '.env' },
        { path: 'missing.txt' },
        { path: 'image.bin' },
        { path: 'README.md' },
      ],
    });
    expect(out).toContain('=== .env ===\nError:');
    expect(out).toContain('not allowed');
    expect(out).toContain('=== missing.txt ===\nError:');
    expect(out).toContain('=== image.bin ===\nError: binary');
    expect(out).toContain('1\t# hello');
    expect(out).not.toContain('super-secret');
  });

  it('refuses a path that leaves the workspace, as read_file does', async () => {
    const out = await run('read_files', { files: [{ path: '../outside/secret.txt' }] });
    expect(out).toContain('outside the workspace');
    expect(out).not.toContain('outside secret');
  });

  it('stops at the output limit and lists what it did not show', async () => {
    const fileCount = 12;
    for (let i = 0; i < fileCount; i += 1) {
      await writeFile(path.join(workspace, `big${i}.txt`), `${'x'.repeat(8_000)}\n`);
    }
    const files = Array.from({ length: fileCount }, (_, i) => ({ path: `big${i}.txt` }));
    const out = await run('read_files', { files });
    expect(out.length).toBeLessThan(MAX_BATCH_CHARS + 2_000);
    expect(out).toContain('=== big0.txt ===');
    expect(out).toMatch(/\[not shown, output limit reached: big\d+\.txt/);
    expect(out).toContain('big11.txt');
  });

  it('wants between one and twenty files', async () => {
    await expect(run('read_files', { files: [] })).rejects.toThrow();
    const many = Array.from({ length: MAX_BATCH_FILES + 1 }, () => ({ path: 'README.md' }));
    await expect(run('read_files', { files: many })).rejects.toThrow();
  });
});

describe('list_dir depth', () => {
  it('shows the tree below a directory in one call, indented, without noise', async () => {
    const out = await run('list_dir', { depth: 2 });
    expect(out).toContain('dir  src\n  file a.ts\n  file b.ts');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('pkg');
  });

  it('stays one level by default, and does not go deeper than asked', async () => {
    expect(await run('list_dir', {})).not.toContain('a.ts');
    await mkdir(path.join(workspace, 'deep/one/two'), { recursive: true });
    await writeFile(path.join(workspace, 'deep/one/two/z.txt'), 'z');
    const out = await run('list_dir', { path: 'deep', depth: 2 });
    expect(out).toBe('dir  one\n  dir  two');
  });

  it('does not follow a link out of the workspace', async () => {
    const out = await run('list_dir', { depth: 3 });
    expect(out).toContain('link escape');
    expect(out).not.toContain('secret.txt');
  });

  it('refuses a depth outside 1 to 4', async () => {
    await expect(run('list_dir', { depth: 0 })).rejects.toThrow();
    await expect(run('list_dir', { depth: 5 })).rejects.toThrow();
  });
});

describe('grep', () => {
  it('finds matches with path and line number, in a stable order', async () => {
    const out = await run('grep', { pattern: 'alpha' });
    expect(out).toBe('src/a.ts:1: const alpha = 1;\nsrc/b.ts:1: export const gamma = alpha;');
  });

  it('supports case-insensitive search and a single-file target', async () => {
    expect(await run('grep', { pattern: 'beta', ignoreCase: true, path: 'src/a.ts' })).toBe(
      'src/a.ts:2: const Beta = 2;',
    );
    expect(await run('grep', { pattern: 'beta' })).toBe('no matches');
  });

  it('never searches secrets, ignored directories, or symlink targets', async () => {
    expect(await run('grep', { pattern: 'secret' })).toBe('no matches');
  });

  it('reports an invalid regular expression', async () => {
    await expect(run('grep', { pattern: '(' })).rejects.toThrow('invalid regular expression');
  });
});

describe('tool specs', () => {
  it('require only the fields without defaults', () => {
    const registry = new ToolRegistry();
    for (const tool of Object.values(tools)) registry.register(tool);
    const required = Object.fromEntries(
      registry
        .specs()
        .map((spec) => [spec.name, (spec.parameters as { required?: string[] }).required]),
    );
    expect(required).toEqual({
      list_dir: undefined,
      read_file: ['path'],
      read_files: ['files'],
      grep: ['pattern'],
    });
  });
});
