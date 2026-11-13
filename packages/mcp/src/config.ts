import { readFileSync } from 'node:fs';

import { z } from 'zod';

/**
 * The MCP servers Orbit connects to, from a file the user edits by hand (`mcp.json` in the data
 * folder). There is deliberately no API to change it: a stdio server is a program started on this
 * machine, so letting a web page add one would let a web page run commands (ADR 0008).
 */

const ServerId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,23}$/, 'server id: lowercase letters, digits, - and _ (max 24)');

const Common = {
  /** Tools of this server that only read. Everything else needs the user's approval. */
  readOnlyTools: z.array(z.string().min(1)).default([]),
  /** Per-call time limit in milliseconds. */
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
  enabled: z.boolean().default(true),
};

const Stdio = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Added to a small safe default (PATH, HOME...); the rest of Orbit's environment is not passed. */
  env: z.record(z.string(), z.string()).default({}),
  ...Common,
});

const Http = z.object({
  transport: z.literal('http'),
  url: z.string().min(1),
  /** Sent with every request, for example an authorization token. Never shown or logged. */
  headers: z.record(z.string(), z.string()).default({}),
  ...Common,
});

export const McpServerConfig = z.discriminatedUnion('transport', [Stdio, Http]);
export type McpServerConfig = z.infer<typeof McpServerConfig>;

export const McpConfig = z.object({
  servers: z.record(ServerId, McpServerConfig).default({}),
});
export type McpConfig = z.infer<typeof McpConfig>;

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Plain http only to this machine: a token sent over http to anywhere else travels in the clear. */
export function checkHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpConfigError('the url is not valid');
  }
  if (url.username || url.password) {
    throw new McpConfigError('the url must not contain credentials; use headers');
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return url;
  throw new McpConfigError('use https (plain http is only allowed for localhost)');
}

/** Parse the config text. Errors name the setting, never its value (values may be secrets). */
export function parseMcpConfig(text: string): McpConfig {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new McpConfigError('mcp.json is not valid JSON');
  }
  const parsed = McpConfig.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? issue.path.join('.') || '(root)' : '(root)';
    throw new McpConfigError(`mcp.json: invalid setting at ${where}: ${issue?.message ?? ''}`);
  }
  for (const [id, server] of Object.entries(parsed.data.servers)) {
    if (server.transport === 'http') {
      try {
        checkHttpUrl(server.url);
      } catch (error) {
        throw new McpConfigError(
          `mcp.json: server "${id}": ${error instanceof Error ? error.message : 'bad url'}`,
        );
      }
    }
  }
  return parsed.data;
}

/** Read the file. A missing file means no MCP servers, which is the normal case. */
export function loadMcpConfig(file: string): McpConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return McpConfig.parse({});
    throw new McpConfigError('mcp.json could not be read');
  }
  return parseMcpConfig(text);
}
