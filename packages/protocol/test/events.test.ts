import { describe, expect, it } from 'vitest';
import { ModelInput, ModelList, ServerInfo, SessionSummary } from '../src/api.js';
import { OrbitEvent } from '../src/events.js';

const base = { id: 'e1', runId: 'r1', seq: 1, ts: 1 };

describe('OrbitEvent', () => {
  it('accepts a valid tool request', () => {
    const parsed = OrbitEvent.parse({
      ...base,
      type: 'tool.requested',
      callId: 'c1',
      tool: 'read_file',
      args: { path: 'a.ts' },
      risk: 'read',
    });
    expect(parsed.type).toBe('tool.requested');
  });

  it('rejects an unknown event type', () => {
    expect(OrbitEvent.safeParse({ ...base, type: 'nope' }).success).toBe(false);
  });

  it('rejects a non-positive seq', () => {
    expect(OrbitEvent.safeParse({ ...base, seq: 0, type: 'run.completed' }).success).toBe(false);
  });

  it('accepts an approval request covering several calls', () => {
    const parsed = OrbitEvent.safeParse({
      ...base,
      type: 'approval.requested',
      approvalId: 'a1',
      items: [
        { callId: 'c1', preview: '--- a\n+++ b' },
        { callId: 'c2', preview: '' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an approval request with no items or no id', () => {
    const request = { ...base, type: 'approval.requested' };
    expect(OrbitEvent.safeParse({ ...request, approvalId: 'a1', items: [] }).success).toBe(false);
    expect(
      OrbitEvent.safeParse({ ...request, approvalId: '', items: [{ callId: 'c', preview: '' }] })
        .success,
    ).toBe(false);
  });

  it('accepts a user message and rejects an empty one', () => {
    expect(OrbitEvent.safeParse({ ...base, type: 'user.message', text: 'hi' }).success).toBe(true);
    expect(OrbitEvent.safeParse({ ...base, type: 'user.message', text: '' }).success).toBe(false);
  });
});

describe('model usage event', () => {
  const usage = { ...base, type: 'model.usage', promptTokens: 1200, completionTokens: 85 };

  it('accepts the tokens one model call used, including zero', () => {
    expect(OrbitEvent.safeParse(usage).success).toBe(true);
    expect(OrbitEvent.safeParse({ ...usage, completionTokens: 0 }).success).toBe(true);
  });

  it('rejects a negative, fractional or missing count', () => {
    expect(OrbitEvent.safeParse({ ...usage, promptTokens: -1 }).success).toBe(false);
    expect(OrbitEvent.safeParse({ ...usage, completionTokens: 1.5 }).success).toBe(false);
    const { completionTokens: _omitted, ...missing } = usage;
    expect(OrbitEvent.safeParse(missing).success).toBe(false);
  });
});

describe('file change events', () => {
  const changed = { ...base, type: 'file.changed', callId: 'c1', path: 'a.txt', after: 'new' };

  it('accepts a change to an existing file and to a new one (before is null)', () => {
    expect(OrbitEvent.safeParse({ ...changed, before: 'old' }).success).toBe(true);
    expect(OrbitEvent.safeParse({ ...changed, before: null }).success).toBe(true);
  });

  it('rejects a change that leaves out before, or has no path', () => {
    expect(OrbitEvent.safeParse(changed).success).toBe(false);
    expect(OrbitEvent.safeParse({ ...changed, before: null, path: '' }).success).toBe(false);
  });

  it('accepts a rollback and rejects one without a call id', () => {
    const rolledback = { ...base, type: 'file.rolledback', callId: 'c1', path: 'a.txt' };
    expect(OrbitEvent.safeParse(rolledback).success).toBe(true);
    expect(OrbitEvent.safeParse({ ...rolledback, callId: '' }).success).toBe(false);
  });
});

describe('API shapes', () => {
  it('accepts a session summary and rejects an unknown status', () => {
    const summary = {
      sessionId: 's1',
      title: 't',
      snippet: '',
      runCount: 1,
      status: 'idle',
      updatedAt: 5,
    };
    expect(SessionSummary.safeParse(summary).success).toBe(true);
    expect(SessionSummary.safeParse({ ...summary, status: 'weird' }).success).toBe(false);
    expect(SessionSummary.safeParse({ ...summary, sessionId: '' }).success).toBe(false);
  });

  it('accepts server info with or without a live model', () => {
    const info = { workspace: '/w', workspaceName: 'w', liveModel: null, modes: ['demo'] };
    expect(ServerInfo.safeParse(info).success).toBe(true);
    expect(ServerInfo.safeParse({ ...info, liveModel: 'm', modes: ['demo', 'live'] }).success).toBe(
      true,
    );
    expect(ServerInfo.safeParse({ ...info, modes: ['other'] }).success).toBe(false);
  });

  it('accepts model input with or without a key, and rejects empty fields', () => {
    const input = { baseUrl: 'https://api.example.com', model: 'm' };
    expect(ModelInput.safeParse(input).success).toBe(true);
    expect(ModelInput.safeParse({ ...input, apiKey: 'k' }).success).toBe(true);
    expect(ModelInput.safeParse({ ...input, apiKey: '  ' }).success).toBe(false);
    expect(ModelInput.safeParse({ ...input, model: '' }).success).toBe(false);
  });

  it('has no place for a key in the model list', () => {
    const model = {
      id: 'm-1',
      label: 'M',
      baseUrl: 'https://a.example',
      model: 'm',
      apiKeyHint: '1234',
      source: 'settings',
    };
    const parsed = ModelList.parse({ models: [{ ...model, apiKey: 'secret' }], defaultId: 'm-1' });
    expect(parsed.models[0]).not.toHaveProperty('apiKey');
    expect(
      ModelList.safeParse({ models: [{ ...model, source: 'none' }], defaultId: null }).success,
    ).toBe(false);
  });

  it('accepts run.started with or without a model name, and rejects an empty one', () => {
    const started = { ...base, type: 'run.started', agentId: 'a', workspace: '/w' };
    expect(OrbitEvent.safeParse(started).success).toBe(true);
    expect(OrbitEvent.safeParse({ ...started, model: 'deepseek-flash' }).success).toBe(true);
    expect(OrbitEvent.safeParse({ ...started, model: '' }).success).toBe(false);
  });
});
