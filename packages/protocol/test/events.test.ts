import { describe, expect, it } from 'vitest';
import { ModelInput, ModelStatus, ServerInfo, SessionSummary } from '../src/api.js';
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

  it('has no place for a key in the model status', () => {
    const status = {
      configured: true,
      source: 'settings',
      baseUrl: 'https://a.example',
      model: 'm',
      apiKeyHint: '1234',
    };
    const parsed = ModelStatus.parse({ ...status, apiKey: 'secret' });
    expect(parsed).not.toHaveProperty('apiKey');
    expect(ModelStatus.safeParse({ ...status, source: 'cloud' }).success).toBe(false);
  });
});
