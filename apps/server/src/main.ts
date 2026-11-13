import os from 'node:os';
import path from 'node:path';

import { serve } from '@hono/node-server';
import {
  createPolicy,
  defaultPolicyConfig,
  loadLlmConfig,
  reportTool,
  ToolRegistry,
  type LlmConfig,
} from '@orbit/core';
import { openStores } from '@orbit/store-sqlite';
import { loadMcpConfig, McpManager } from '@orbit/mcp';
import type { McpStatus } from '@orbit/protocol';
import { createRollback, createTools } from '@orbit/tools';

import { ApprovalBroker } from './approvals.js';
import { createApp } from './app.js';
import { BroadcastingStore } from './broadcast-store.js';
import { createDemoLlm } from './demo-llm.js';
import { recoverInterruptedRuns } from './recover.js';
import { ModelManager } from './models.js';
import { RunManager } from './runs.js';
import { SettingsStore } from './settings.js';

const port = Number(process.env['ORBIT_PORT'] ?? 8787);
// The folder the agent may read. Defaults to where the server was started.
const workspace = process.env['ORBIT_WORKSPACE'] ?? process.cwd();
// Where conversations are kept. They include the contents of files the agent read, so the folder
// is created readable by the current user only.
const dataDir = process.env['ORBIT_DATA_DIR'] ?? path.join(os.homedir(), '.orbit');

// Model settings saved in the UI win over .env; with neither, only the scripted demo is available.
let envConfig: LlmConfig | undefined;
try {
  envConfig = loadLlmConfig(process.env);
} catch {
  envConfig = undefined;
}
const models = new ModelManager({
  settings: new SettingsStore(path.join(dataDir, 'settings.json')),
  env: envConfig,
});
if (!models.current())
  console.log('live mode disabled (no model configured; see the settings page)');

const registry = new ToolRegistry();
for (const tool of await createTools(workspace)) registry.register(tool);
registry.register(reportTool());

// MCP servers come from mcp.json, which the user edits by hand. A broken file or a server that
// will not start is reported on the settings page and never stops Orbit.
let mcpManager: McpManager | undefined;
let mcpConfigError: string | null = null;
try {
  mcpManager = await McpManager.start(loadMcpConfig(path.join(dataDir, 'mcp.json')));
  for (const tool of mcpManager.tools()) {
    try {
      registry.register(tool);
    } catch (error) {
      console.log(`mcp: skipped ${tool.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  for (const server of mcpManager.status()) {
    if (server.state === 'connected') {
      console.log(`mcp: ${server.id} connected (${server.tools.length} tools)`);
    } else if (server.state === 'failed') {
      console.log(`mcp: ${server.id} failed: ${server.error}`);
    }
  }
} catch (error) {
  mcpConfigError = error instanceof Error ? error.message : String(error);
  console.log(`mcp: not started: ${mcpConfigError}`);
}
const mcp = {
  status: (): McpStatus => ({ servers: mcpManager?.status() ?? [], configError: mcpConfigError }),
};

const stores = openStores(path.join(dataDir, 'orbit.db'));
const interrupted = recoverInterruptedRuns(stores.sessions, stores.events);
if (interrupted > 0) console.log(`closed ${interrupted} run(s) interrupted by the last shutdown`);

const store = new BroadcastingStore(stores.events);
const approvals = new ApprovalBroker();
const runs = new RunManager({
  store,
  sessions: stores.sessions,
  registry,
  workspace,
  // Read freely, ask the user before writing, refuse anything dangerous.
  policy: createPolicy(defaultPolicyConfig),
  approver: approvals,
  demoLlm: createDemoLlm(),
  rollback: await createRollback(workspace),
  live: () => models.current(),
});
const app = createApp({ store, runs, approvals, models, mcp });

// Bind to loopback only: this is a local-first tool, not a network service.
const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`orbit server listening on http://127.0.0.1:${info.port}`);
  console.log(`workspace: ${workspace}`);
  console.log(`data: ${path.join(dataDir, 'orbit.db')}`);
});

// Close the database cleanly so the last writes are flushed to the main file.
function shutdown(): void {
  server.close();
  // Stops the processes started for stdio MCP servers, or they would outlive Orbit.
  void (mcpManager?.close() ?? Promise.resolve()).finally(() => {
    stores.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
