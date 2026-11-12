import type { EventStore } from '@orbit/core';
import { Hono } from 'hono';

export function createApp(store: EventStore) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/runs/:runId/events', (c) => {
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return c.json({ error: 'after must be a non-negative integer' }, 400);
    }
    return c.json({ events: store.read(c.req.param('runId'), after) });
  });

  return app;
}
