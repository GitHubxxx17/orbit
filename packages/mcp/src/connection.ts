import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@orbit/core';
import type { McpToolInfo } from '@orbit/protocol';

import { checkHttpUrl, type McpServerConfig } from './config.js';
import { convertTool, type McpCallResult, type McpToolDefinition } from './tools.js';

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_TOOLS = 200;
const MAX_PAGES = 10;

export interface McpConnection {
  tools: Tool[];
  infos: McpToolInfo[];
  /** Tools the server offered that were left out, with the reason. */
  skipped: string[];
  close(): Promise<void>;
}

/** Secrets must not appear in an error shown to the user or written to a log. */
export function redact(message: string, config: McpServerConfig): string {
  const secrets = Object.values(config.transport === 'stdio' ? config.env : config.headers);
  let text = message;
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join('[已隐藏]');
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} 超过 ${ms / 1000} 秒`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createTransport(config: McpServerConfig): Transport {
  if (config.transport === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      // Merged by the SDK with a short safe list (PATH, HOME...), not with Orbit's own environment.
      env: config.env,
      // The server's own log output would otherwise land in Orbit's terminal.
      stderr: 'ignore',
    });
  }
  return new StreamableHTTPClientTransport(checkHttpUrl(config.url), {
    requestInit: { headers: config.headers },
  });
}

/**
 * Connect to one server, list its tools and wrap them. Throws if it cannot connect; the caller
 * decides that one broken server must not stop the others.
 */
export async function connectServer(
  id: string,
  config: McpServerConfig,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
): Promise<McpConnection> {
  const client = new Client({ name: 'orbit', version: '0.0.0' }, { capabilities: {} });
  try {
    await withTimeout(client.connect(createTransport(config)), connectTimeoutMs, '连接');

    const definitions: McpToolDefinition[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const listed = await withTimeout(
        client.listTools(cursor ? { cursor } : undefined),
        connectTimeoutMs,
        '读取工具列表',
      );
      for (const tool of listed.tools) {
        definitions.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      cursor = listed.nextCursor;
      if (!cursor) break;
    }

    const tools: Tool[] = [];
    const infos: McpToolInfo[] = [];
    const skipped: string[] = [];
    const readOnly = new Set(config.readOnlyTools);
    const seen = new Set<string>();
    for (const definition of definitions.slice(0, MAX_TOOLS)) {
      const converted = convertTool(
        id,
        definition,
        async (name, args, { signal, timeoutMs }) =>
          (await client.callTool({ name, arguments: args }, undefined, {
            signal,
            timeout: timeoutMs,
          })) as McpCallResult,
        { readOnly: readOnly.has(definition.name), timeoutMs: config.timeoutMs },
      );
      if (!converted.ok) skipped.push(converted.reason);
      else if (seen.has(converted.tool.name)) {
        skipped.push(`${definition.name}: 与另一个工具重名`);
      } else {
        seen.add(converted.tool.name);
        tools.push(converted.tool);
        infos.push(converted.info);
      }
    }
    if (definitions.length > MAX_TOOLS) {
      skipped.push(`超过 ${MAX_TOOLS} 个，其余没有使用`);
    }
    return { tools, infos, skipped, close: () => client.close() };
  } catch (error) {
    // Closing also stops a stdio child that was already started.
    await client.close().catch(() => undefined);
    throw error;
  }
}
