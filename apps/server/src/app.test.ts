import { InMemoryEventStore } from '@orbit/core';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('server app', () => {
  it('reports health', async () => {
    const res = await createApp(new InMemoryEventStore()).request('/health');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns a run event log', async () => {
    const store = new InMemoryEventStore();
    store.append('r1', { type: 'message.delta', text: 'hi' });
    const res = await createApp(store).request('/runs/r1/events');
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('rejects an invalid after cursor', async () => {
    const res = await createApp(new InMemoryEventStore()).request('/runs/r1/events?after=-1');
    expect(res.status).toBe(400);
  });
});
