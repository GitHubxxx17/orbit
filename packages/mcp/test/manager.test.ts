import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ToolRegistry, type Tool } from '@orbit/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { McpManager, parseMcpConfig, type McpConfig } from '../src/index.js';
// @ts-expect-error plain .mjs fixture shared by the stdio and HTTP servers
import { registerFixtureTools } from './fixtures/tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures/server.mjs');
const context = () => ({ signal: new AbortController().signal });

const stdioConfig = (extra: Record<string, unknown> = {}): McpConfig =>
  parseMcpConfig(
    JSON.stringify({
      servers: {
        fx: { transport: 'stdio', command: process.execPath, args: [FIXTURE], ...extra },
      },
    }),
  );

const open: McpManager[] = [];
async function start(config: McpConfig, connectTimeoutMs?: number): Promise<McpManager> {
  const manager = await McpManager.start(config, connectTimeoutMs);
  open.push(manager);
  return manager;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((manager) => manager.close()));
});

function tool(manager: McpManager, name: string): Tool {
  const found = manager.tools().find((t) => t.name === `mcp__fx__${name}`);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

beforeAll(() => {
  process.env['ORBIT_TEST_SECRET'] = 'must-not-reach-the-server';
});

describe('a stdio server', () => {
  it('connects and exposes its tools under namespaced names', async () => {
    const manager = await start(stdioConfig());
    const [info] = manager.status();
    expect(info).toMatchObject({ id: 'fx', transport: 'stdio', state: 'connected', error: null });
    const names = manager.tools().map((t) => t.name);
    expect(names).toContain('mcp__fx__echo');
    expect(names.every((name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name))).toBe(true);
  });

  it('runs a tool and returns its text', async () => {
    const manager = await start(stdioConfig());
    expect(await tool(manager, 'echo').run({ text: 'hello' }, context())).toBe('hello');
  });

  it('gives the model the server’s own JSON Schema', async () => {
    const manager = await start(stdioConfig());
    const registry = new ToolRegistry();
    for (const t of manager.tools()) registry.register(t);
    const spec = registry.specs().find((s) => s.name === 'mcp__fx__echo');
    expect(spec?.parameters).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
  });

  it('treats a tool as a write needing approval unless the config says it only reads', async () => {
    const manager = await start(stdioConfig({ readOnlyTools: ['echo'] }));
    expect(tool(manager, 'echo').risk).toBe('read');
    expect(tool(manager, 'fail').risk).toBe('write');
    const risks = Object.fromEntries(manager.status()[0]?.tools.map((t) => [t.name, t.risk]) ?? []);
    expect(risks['mcp__fx__echo']).toBe('read');
    expect(risks['mcp__fx__big']).toBe('write');
  });

  it('shows the user what would be sent before they approve', async () => {
    const manager = await start(stdioConfig());
    const preview = await tool(manager, 'echo').preview?.({ text: 'hi' }, context());
    expect(preview).toContain('fx');
    expect(preview).toContain('echo');
    expect(preview).toContain('"text": "hi"');
  });

  it('turns an error reported by the server into a failed call', async () => {
    const manager = await start(stdioConfig());
    await expect(tool(manager, 'fail').run({}, context())).rejects.toThrow('something went wrong');
  });

  it('caps a huge result and names binary content instead of inlining it', async () => {
    const manager = await start(stdioConfig());
    const big = await tool(manager, 'big').run({}, context());
    expect(big.length).toBeLessThan(21_000);
    expect(big).toContain('已截断');
    const picture = await tool(manager, 'picture').run({}, context());
    expect(picture).toContain('[图片，未显示]');
    expect(picture).toContain('caption');
  });

  it('stops waiting when the run is cancelled', async () => {
    const manager = await start(stdioConfig());
    const controller = new AbortController();
    const pending = tool(manager, 'slow').run({}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow();
  });

  it('gives up on a call that takes longer than the configured time', async () => {
    const manager = await start(stdioConfig({ timeoutMs: 1000 }));
    await expect(tool(manager, 'slow').run({}, context())).rejects.toThrow();
  });

  it('does not pass Orbit’s environment to the server, only what the config lists', async () => {
    const manager = await start(stdioConfig({ env: { FIXTURE_FLAG: 'on' } }));
    const seen = JSON.parse(await tool(manager, 'env').run({}, context())) as {
      secret: string | null;
      configured: string | null;
    };
    expect(seen.secret).toBeNull();
    expect(seen.configured).toBe('on');
  });

  it('rewrites an unusable tool name and cleans a hostile description', async () => {
    const manager = await start(stdioConfig());
    expect(manager.tools().map((t) => t.name)).toContain('mcp__fx__bad_name_');
    const poison = tool(manager, 'poison');
    expect(
      [...poison.description].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    ).toBe(true);
    expect(poison.description.length).toBeLessThan(560);
  });

  it('refuses arguments that are not an object', async () => {
    const manager = await start(stdioConfig());
    await expect(tool(manager, 'echo').run('text', context())).rejects.toThrow();
  });
});

describe('a server that cannot start', () => {
  it('is reported as failed without stopping the others', async () => {
    const config = parseMcpConfig(
      JSON.stringify({
        servers: {
          good: { transport: 'stdio', command: process.execPath, args: [FIXTURE] },
          bad: { transport: 'stdio', command: 'orbit-no-such-program', args: [] },
        },
      }),
    );
    const manager = await start(config);
    const states = Object.fromEntries(manager.status().map((s) => [s.id, s.state]));
    expect(states).toEqual({ good: 'connected', bad: 'failed' });
    expect(manager.status().find((s) => s.id === 'bad')?.error).toBeTruthy();
    expect(manager.tools().length).toBeGreaterThan(0);
  });

  it('does not wait forever for a server that never answers', async () => {
    const config = parseMcpConfig(
      JSON.stringify({
        servers: {
          quiet: {
            transport: 'stdio',
            command: process.execPath,
            args: ['-e', 'setInterval(() => {}, 1000)'],
          },
        },
      }),
    );
    const manager = await start(config, 800);
    expect(manager.status()[0]).toMatchObject({ state: 'failed' });
    expect(manager.status()[0]?.error).toContain('超过');
  });

  it('leaves a disabled server alone', async () => {
    const manager = await start(stdioConfig({ enabled: false }));
    expect(manager.status()[0]).toMatchObject({ state: 'disabled', tools: [] });
    expect(manager.tools()).toEqual([]);
  });

  it('never puts a configured secret in the error', async () => {
    const config = parseMcpConfig(
      JSON.stringify({
        servers: {
          leak: {
            transport: 'stdio',
            command: 'orbit-no-such-program-hunter2hunter2',
            env: { TOKEN: 'hunter2hunter2' },
          },
        },
      }),
    );
    const manager = await start(config);
    expect(manager.status()[0]?.error).not.toContain('hunter2hunter2');
  });
});

describe('an HTTP server', () => {
  let http: Server | undefined;
  afterEach(async () => {
    // The client keeps a connection open; close it so the listener can stop.
    http?.closeAllConnections();
    await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()));
    http = undefined;
  });

  /** A real Streamable HTTP MCP server on a free loopback port; records the headers it receives. */
  async function listen(seenHeaders: Record<string, string | string[] | undefined>[]) {
    http = createServer((req, res) => {
      seenHeaders.push({ ...req.headers });
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        void (async () => {
          const server = new McpServer({ name: 'fixture-http', version: '1.0.0' });
          registerFixtureTools(server);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          } as never);
          res.on('close', () => void transport.close());
          await server.connect(transport);
          const text = Buffer.concat(chunks).toString('utf8');
          await transport.handleRequest(req, res, text === '' ? undefined : JSON.parse(text));
        })();
      });
    });
    await new Promise<void>((resolve) => http?.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(http?.address() as AddressInfo).port}/mcp`;
  }

  it('connects, sends the configured headers, and runs a tool', async () => {
    const seen: Record<string, string | string[] | undefined>[] = [];
    const url = await listen(seen);
    const manager = await start(
      parseMcpConfig(
        JSON.stringify({
          servers: { fx: { transport: 'http', url, headers: { authorization: 'Bearer abc123' } } },
        }),
      ),
    );
    expect(manager.status()[0]).toMatchObject({ transport: 'http', state: 'connected' });
    expect(await tool(manager, 'echo').run({ text: 'over http' }, context())).toBe('over http');
    expect(seen.some((headers) => headers['authorization'] === 'Bearer abc123')).toBe(true);
  });
});
