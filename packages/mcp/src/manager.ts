import type { Tool } from '@orbit/core';
import type { McpServerInfo } from '@orbit/protocol';

import { connectServer, redact, type McpConnection } from './connection.js';
import type { McpConfig } from './config.js';

/**
 * Owns the connections to every configured server. A server that fails to start is reported and
 * left out; it never stops the others or Orbit itself. Servers are read once at start-up: to pick
 * up a changed config, restart Orbit.
 */
export class McpManager {
  private constructor(
    private readonly servers: McpServerInfo[],
    private readonly connections: McpConnection[],
  ) {}

  static async start(config: McpConfig, connectTimeoutMs?: number): Promise<McpManager> {
    const connections: McpConnection[] = [];
    const entries = Object.entries(config.servers);
    const servers = await Promise.all(
      entries.map(async ([id, server]): Promise<McpServerInfo> => {
        const base = { id, transport: server.transport } as const;
        if (!server.enabled) {
          return { ...base, state: 'disabled', error: null, tools: [], skipped: [] };
        }
        try {
          const connection = await connectServer(id, server, connectTimeoutMs);
          connections.push(connection);
          return {
            ...base,
            state: 'connected',
            error: null,
            tools: connection.infos,
            skipped: connection.skipped,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ...base,
            state: 'failed',
            error: redact(message, server),
            tools: [],
            skipped: [],
          };
        }
      }),
    );
    return new McpManager(servers, connections);
  }

  /** Every tool of every connected server, ready to register. */
  tools(): Tool[] {
    return this.connections.flatMap((connection) => connection.tools);
  }

  status(): McpServerInfo[] {
    return this.servers.map((server) => ({ ...server }));
  }

  /** Disconnect; this also stops the processes started for stdio servers. */
  async close(): Promise<void> {
    await Promise.all(
      this.connections.map((connection) => connection.close().catch(() => undefined)),
    );
  }
}
