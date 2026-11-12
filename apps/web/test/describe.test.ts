import { describe, expect, it } from 'vitest';

import { describeTool } from '@/state/describe';

describe('describeTool', () => {
  it.each([
    ['list_dir', {}, '查看工作区目录'],
    ['list_dir', { path: '.' }, '查看工作区目录'],
    ['list_dir', { path: 'src' }, '查看目录 src'],
    ['read_file', { path: 'package.json' }, '读取 package.json'],
    ['read_file', { path: 'a.ts', limit: 8 }, '读取 a.ts 第 1-8 行'],
    ['read_file', { path: 'a.ts', offset: 9, limit: 4 }, '读取 a.ts 第 9-12 行'],
    ['read_file', { path: 'a.ts', offset: 9 }, '读取 a.ts 第 9-末尾 行'],
    ['read_file', {}, '读取文件'],
    ['grep', { pattern: 'alpha' }, '搜索“alpha”'],
    ['grep', { pattern: 'alpha', path: 'src' }, '在 src 中搜索“alpha”'],
    ['grep', {}, '搜索代码'],
    ['write_file', { path: 'x' }, '调用 write_file'],
  ])('%s %j -> %s', (tool, args, expected) => {
    expect(describeTool(tool, args)).toBe(expected);
  });

  it('ignores arguments of the wrong type instead of printing them', () => {
    expect(describeTool('read_file', { path: 42 })).toBe('读取文件');
    expect(describeTool('read_file', { path: 'a.ts', limit: '8' })).toBe('读取 a.ts');
    expect(describeTool('grep', { pattern: { x: 1 } })).toBe('搜索代码');
  });

  it('shortens a very long search pattern', () => {
    const label = describeTool('grep', { pattern: 'x'.repeat(100) });
    expect(label).toBe(`搜索“${'x'.repeat(40)}…”`);
  });
});
