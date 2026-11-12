import { describe, expect, it } from 'vitest';
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
});
