import os from 'node:os';
import path from 'node:path';

import { serve } from '@hono/node-server';
import {
  createOpenAICompatibleClient,
  createPolicy,
  defaultPolicyConfig,
  loadLlmConfig,
  ToolRegistry,
  type LlmClient,
} from '@orbit/core';
import { openStores } from '@orbit/store-sqlite';
import { createTools } from '@orbit/tools';

import { ApprovalBroker } from './approvals.js';
import { createApp } from './app.js';
import { BroadcastingStore } from './broadcast-store.js';
import { createDemoLlm } from './demo-llm.js';
import { recoverInterruptedRuns } from './recover.js';
import { RunManager } from './runs.js';

const port = Number(process.env['ORBIT_PORT'] ?? 8787);
// The folder the agent may read. Defaults to where the server was started.
const workspace = process.env['ORBIT_WORKSPACE'] ?? process.cwd();
// Where conversations are kept. They include the contents of files the agent read, so the folder
// is created readable by the current user only.
const dataDir = process.env['ORBIT_DATA_DIR'] ?? path.join(os.homedir(), '.orbit');

// Live mode is optional: without model settings only the scripted demo is available.
let liveLlm: LlmClient | undefined;
let liveModel: string | undefined;
try {
  const config = loadLlmConfig(process.env);
  liveLlm = createOpenAICompatibleClient(config);
  liveModel = config.model;
} catch (error) {
  console.log(
    `live mode disabled (${error instanceof Error ? error.message : 'invalid settings'})`,
  );
}

const registry = new ToolRegistry();
for (const tool of await createTools(workspace)) registry.register(tool);

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
  ...(liveLlm ? { liveLlm } : {}),
  ...(liveModel ? { liveModel } : {}),
});
const app = createApp({ store, runs, approvals });

// Bind to loopback only: this is a local-first tool, not a network service.
const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`orbit server listening on http://127.0.0.1:${info.port}`);
  console.log(`workspace: ${workspace}`);
  console.log(`data: ${path.join(dataDir, 'orbit.db')}`);
});

// Close the database cleanly so the last writes are flushed to the main file.
function shutdown(): void {
  server.close();
  stores.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
