import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadMcpConfig,
  McpConfigError,
  orbitToolName,
  parseMcpConfig,
  renderResult,
} from '../src/index.js';

describe('parseMcpConfig', () => {
  const parse = (servers: unknown) => parseMcpConfig(JSON.stringify({ servers }));

  it('fills in defaults', () => {
    const { servers } = parse({ a: { transport: 'stdio', command: 'node' } });
    expect(servers['a']).toMatchObject({
      args: [],
      env: {},
      readOnlyTools: [],
      timeoutMs: 60_000,
      enabled: true,
    });
  });

  it('accepts https, and http only for this machine', () => {
    expect(() =>
      parse({ a: { transport: 'http', url: 'https://mcp.example.com/mcp' } }),
    ).not.toThrow();
    expect(() =>
      parse({ a: { transport: 'http', url: 'http://127.0.0.1:3000/mcp' } }),
    ).not.toThrow();
    expect(() => parse({ a: { transport: 'http', url: 'http://mcp.example.com/mcp' } })).toThrow(
      /https/,
    );
  });

  it('rejects credentials in the url and a url that is not a url', () => {
    expect(() => parse({ a: { transport: 'http', url: 'https://u:p@example.com' } })).toThrow(
      /credentials/,
    );
    expect(() => parse({ a: { transport: 'http', url: 'nope' } })).toThrow(McpConfigError);
  });

  it('rejects a bad server id, an unknown transport, and text that is not JSON', () => {
    expect(() => parse({ 'Bad Id': { transport: 'stdio', command: 'x' } })).toThrow(McpConfigError);
    expect(() => parse({ a: { transport: 'websocket', url: 'x' } })).toThrow(McpConfigError);
    expect(() => parseMcpConfig('{ nope')).toThrow('not valid JSON');
  });

  it('names the setting that is wrong but never repeats a secret', () => {
    try {
      parse({ a: { transport: 'http', url: 'https://x.example.com', headers: { k: 5 } } });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain('servers.a.headers');
    }
    try {
      parse({ a: { transport: 'stdio', command: '', env: { TOKEN: 'secret-value-123' } } });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('secret-value-123');
    }
  });
});

describe('loadMcpConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'orbit-mcp-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('treats a missing file as no servers', () => {
    expect(loadMcpConfig(path.join(dir, 'mcp.json')).servers).toEqual({});
  });

  it('reads a file', async () => {
    const file = path.join(dir, 'mcp.json');
    await writeFile(file, JSON.stringify({ servers: { a: { transport: 'stdio', command: 'x' } } }));
    expect(Object.keys(loadMcpConfig(file).servers)).toEqual(['a']);
  });

  it('refuses a broken file instead of silently ignoring it', async () => {
    const file = path.join(dir, 'mcp.json');
    await writeFile(file, '{ nope');
    expect(() => loadMcpConfig(file)).toThrow(McpConfigError);
  });
});

describe('orbitToolName', () => {
  it('namespaces by server and rewrites unusable characters', () => {
    expect(orbitToolName('fs', 'read file.txt')).toBe('mcp__fs__read_file_txt');
  });

  it('gives up on a name longer than the API allows', () => {
    expect(orbitToolName('fs', 'a'.repeat(80))).toBeNull();
  });
});

describe('renderResult', () => {
  it('joins text blocks and falls back to structured content', () => {
    expect(
      renderResult({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('a\nb');
    expect(renderResult({ content: [], structuredContent: { n: 1 } })).toBe('{"n":1}');
  });

  it('names resources instead of inlining binary data', () => {
    expect(renderResult({ content: [{ type: 'resource_link', uri: 'file:///x' }] })).toContain(
      'file:///x',
    );
    expect(renderResult({ content: [{ type: 'audio', data: 'AAAA' }] })).toContain('音频');
  });
});
