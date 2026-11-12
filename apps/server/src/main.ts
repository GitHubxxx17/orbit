import { serve } from '@hono/node-server';
import {
  createOpenAICompatibleClient,
  createPolicy,
  defaultPolicyConfig,
  InMemoryEventStore,
  loadLlmConfig,
  ToolRegistry,
  type LlmClient,
} from '@orbit/core';
import { createTools } from '@orbit/tools';

import { ApprovalBroker } from './approvals.js';
import { createApp } from './app.js';
import { BroadcastingStore } from './broadcast-store.js';
import { createDemoLlm } from './demo-llm.js';
import { RunManager } from './runs.js';

const port = Number(process.env['ORBIT_PORT'] ?? 8787);
// The folder the agent may read. Defaults to where the server was started.
const workspace = process.env['ORBIT_WORKSPACE'] ?? process.cwd();

// Live mode is optional: without model settings only the scripted demo is available.
let liveLlm: LlmClient | undefined;
try {
  liveLlm = createOpenAICompatibleClient(loadLlmConfig(process.env));
} catch (error) {
  console.log(
    `live mode disabled (${error instanceof Error ? error.message : 'invalid settings'})`,
  );
}

const registry = new ToolRegistry();
for (const tool of await createTools(workspace)) registry.register(tool);

const store = new BroadcastingStore(new InMemoryEventStore());
const approvals = new ApprovalBroker();
const runs = new RunManager({
  store,
  registry,
  workspace,
  // Read freely, ask the user before writing, refuse anything dangerous.
  policy: createPolicy(defaultPolicyConfig),
  approver: approvals,
  demoLlm: createDemoLlm(),
  ...(liveLlm ? { liveLlm } : {}),
});
const app = createApp({ store, runs, approvals });

// Bind to loopback only: this is a local-first tool, not a network service.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`orbit server listening on http://127.0.0.1:${info.port}`);
  console.log(`workspace: ${workspace}`);
});
