import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defineTool,
  InMemoryEventStore,
  ToolRegistry,
  reportTool,
  type ChatRequest,
  type LlmClient,
} from '@orbit/core';
import type { OrbitEvent, ToolInfo } from '@orbit/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AgentError, AgentManager, AgentStore } from '../src/agents.js';
import { ApprovalBroker } from '../src/approvals.js';
import { createApp } from '../src/app.js';
import { BroadcastingStore } from '../src/broadcast-store.js';
import { createDemoLlm } from '../src/demo-llm.js';
import { RunManager, RunRejected } from '../src/runs.js';

const TOOLS: ToolInfo[] = [
  { name: 'read_file', risk: 'read', description: 'read' },
  { name: 'write_file', risk: 'write', description: 'write' },
  { name: 'report', risk: 'read', description: 'report' },
];

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agents-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = () => path.join(dir, 'nested', 'agents.json');

function manager(models: string[] = ['m-1']) {
  let counter = 0;
  return new AgentManager({
    store: new AgentStore(file()),
    tools: () => TOOLS,
    hasModel: (id) => models.includes(id),
    newId: () => `a-${(counter += 1)}`,
  });
}

describe('AgentManager', () => {
  it('always has the built-in agent first, and it cannot be changed or removed', () => {
    const m = manager();
    expect(m.list().agents[0]).toMatchObject({ id: 'default', builtin: true, tools: null });
    expect(() => m.save('default', { name: 'x' })).toThrow(AgentError);
    expect(() => m.remove('default')).toThrow(AgentError);
  });

  it('adds, changes and removes an agent, and keeps it across a restart', () => {
    const m = manager();
    m.save(undefined, {
      name: ' Reviewer ',
      instructions: 'Be strict.',
      modelId: 'm-1',
      tools: ['read_file', 'read_file'],
    });
    expect(m.list().agents[1]).toEqual({
      id: 'a-1',
      name: 'Reviewer',
      description: '',
      instructions: 'Be strict.',
      modelId: 'm-1',
      tools: ['read_file'],
      builtin: false,
    });
    expect(manager().list().agents).toHaveLength(2);
    m.save('a-1', { name: 'Reviewer 2', tools: null });
    expect(m.list().agents[1]).toMatchObject({ name: 'Reviewer 2', tools: null, modelId: null });
    expect(m.remove('a-1').agents).toHaveLength(1);
  });

  it('refuses tools and models that do not exist, and unknown agents', () => {
    const m = manager();
    expect(() => m.save(undefined, { name: 'x', tools: ['rm_rf'] })).toThrow(/rm_rf/);
    expect(() => m.save(undefined, { name: 'x', modelId: 'ghost' })).toThrow(AgentError);
    expect(() => m.save('ghost', { name: 'x' })).toThrow(AgentError);
    expect(() => m.remove('ghost')).toThrow(AgentError);
  });

  it('writes the file privately and treats a corrupt file as having no agents', () => {
    manager().save(undefined, { name: 'x' });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    fs.writeFileSync(file(), '{nope');
    expect(manager().list().agents).toHaveLength(1);
  });
});

describe('agent routes', () => {
  function setup() {
    const app = createApp({
      store: new BroadcastingStore(new InMemoryEventStore()),
      runs: {} as never,
      approvals: new ApprovalBroker(),
      agents: manager(),
    });
    const send = (method: string, url: string, body?: unknown, type = 'application/json') =>
      app.request(url, {
        method,
        headers: { host: 'localhost', 'content-type': type },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { send };
  }

  it('lists, adds, changes and removes', async () => {
    const { send } = setup();
    expect(
      ((await (await send('GET', '/agents')).json()) as { agents: unknown[] }).agents,
    ).toHaveLength(1);
    expect((await send('POST', '/agents', { name: 'A', tools: ['read_file'] })).status).toBe(201);
    expect((await send('PUT', '/agents/a-1', { name: 'B' })).status).toBe(200);
    expect(
      ((await (await send('GET', '/agents/tools')).json()) as { tools: unknown[] }).tools,
    ).toHaveLength(3);
    expect((await send('DELETE', '/agents/a-1')).status).toBe(200);
  });

  it('answers 400 for bad input, unknown tools and the built-in agent, 415 for non-JSON', async () => {
    const { send } = setup();
    expect((await send('POST', '/agents', { name: '' })).status).toBe(400);
    expect((await send('POST', '/agents', { name: 'A', tools: ['rm_rf'] })).status).toBe(400);
    expect((await send('PUT', '/agents/default', { name: 'A' })).status).toBe(400);
    expect((await send('DELETE', '/agents/default')).status).toBe(400);
    expect((await send('POST', '/agents', { name: 'A' }, 'text/plain')).status).toBe(415);
  });
});

describe('a run with an agent profile', () => {
  const tool = (name: string, risk: 'read' | 'write') =>
    defineTool({
      name,
      description: name,
      risk,
      schema: z.object({}),
      execute: async () => 'ok',
    });

  function stack() {
    const requests: ChatRequest[] = [];
    const used: (string | undefined)[] = [];
    const llm: LlmClient = {
      async *stream(request) {
        requests.push(request);
        yield { type: 'text-delta', text: 'ok' };
        yield { type: 'finish', reason: 'stop', usage: null };
      },
    };
    const store = new BroadcastingStore(new InMemoryEventStore());
    const registry = new ToolRegistry()
      .register(tool('read_file', 'read'))
      .register(tool('write_file', 'write'))
      .register(reportTool());
    const models = ['m-1', 'm-2'];
    const agents = manager(models);
    const runs = new RunManager({
      store,
      registry,
      agents,
      workspace: '/w',
      demoLlm: createDemoLlm(0),
      live: (id) => {
        used.push(id);
        return id === undefined || models.includes(id)
          ? { llm, name: id ?? 'default-model' }
          : undefined;
      },
    });
    const started = async (run: { runId: string }) => {
      // The run is not awaited by start(); give it a moment to finish.
      for (let i = 0; i < 50; i += 1) {
        const events = store.read(run.runId);
        if (events.some((e) => e.type === 'run.completed' || e.type === 'run.failed'))
          return events;
        await new Promise((r) => setTimeout(r, 5));
      }
      return store.read(run.runId);
    };
    return { runs, agents, models, requests, used, started };
  }

  const toolNames = (r: ChatRequest) => (r.tools ?? []).map((t) => t.name).sort();
  const first = (events: OrbitEvent[]) => events[0] as Extract<OrbitEvent, { type: 'run.started' }>;

  it('uses every tool and the plain prompt for the built-in agent', async () => {
    const { runs, requests, started } = stack();
    await started(runs.start({ prompt: 'hi', mode: 'live' }));
    expect(toolNames(requests[0]!)).toEqual(['read_file', 'report', 'write_file']);
    expect(JSON.stringify(requests[0]!.messages)).not.toContain('Additional instructions');
  });

  it('narrows the tools, keeps report, adds the instructions and records the agent', async () => {
    const { runs, agents, requests, started } = stack();
    agents.save(undefined, { name: 'Reader', instructions: 'Only read.', tools: ['read_file'] });
    const events = await started(runs.start({ prompt: 'hi', mode: 'live', agentId: 'a-1' }));
    expect(toolNames(requests[0]!)).toEqual(['read_file', 'report']);
    expect(JSON.stringify(requests[0]!.messages)).toContain('Only read.');
    expect(first(events)).toMatchObject({ agentId: 'a-1', agentName: 'Reader' });
  });

  it('takes the agent’s model unless one is asked for, and falls back when it was deleted', async () => {
    const { runs, agents, used, started } = stack();
    agents.save(undefined, { name: 'A', modelId: 'm-2' });
    await started(runs.start({ prompt: 'x', mode: 'live', agentId: 'a-1' }));
    expect(used).toContain('m-2');
    const explicit = await started(
      runs.start({ prompt: 'x', mode: 'live', agentId: 'a-1', modelId: 'm-1' }),
    );
    expect(first(explicit).model).toBe('m-1');
  });

  it('falls back to the default model when the agent’s model was deleted', async () => {
    const { runs, agents, models, started } = stack();
    agents.save(undefined, { name: 'A', modelId: 'm-2' });
    models.splice(1, 1);
    const events = await started(runs.start({ prompt: 'x', mode: 'live', agentId: 'a-1' }));
    expect(first(events).model).toBe('default-model');
  });

  it('asks for a report only when the server has the report tool', async () => {
    const withReport = stack();
    await withReport.started(withReport.runs.start({ prompt: 'hi', mode: 'live' }));
    expect(JSON.stringify(withReport.requests[0]!.messages)).toContain('call report once');
    expect(withReport.runs.info().report).toBe(true);

    const requests: ChatRequest[] = [];
    const llm: LlmClient = {
      async *stream(request) {
        requests.push(request);
        yield { type: 'text-delta', text: 'ok' };
        yield { type: 'finish', reason: 'stop', usage: null };
      },
    };
    const store = new BroadcastingStore(new InMemoryEventStore());
    const runs = new RunManager({
      store,
      registry: new ToolRegistry().register(tool('read_file', 'read')),
      workspace: '/w',
      demoLlm: createDemoLlm(0),
      live: () => ({ llm, name: 'm' }),
    });
    const run = runs.start({ prompt: 'hi', mode: 'live' });
    for (let i = 0; i < 50 && !store.read(run.runId).some((e) => e.type === 'run.completed'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(JSON.stringify(requests[0]!.messages)).not.toContain('call report');
    expect(requests[0]!.tools?.map((t) => t.name)).toEqual(['read_file']);
    expect(runs.info().report).toBe(false);
  });

  it('refuses an unknown agent', () => {
    const { runs } = stack();
    expect(() => runs.start({ prompt: 'x', mode: 'live', agentId: 'ghost' })).toThrow(RunRejected);
  });

  it('ignores the agent in demo mode', async () => {
    const { runs, started } = stack();
    const events = await started(runs.start({ prompt: 'x', mode: 'demo', agentId: 'ghost' }));
    expect(first(events).agentId).toBe('orbit-demo');
  });
});
