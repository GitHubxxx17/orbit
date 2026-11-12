import type { OrbitEvent } from '@orbit/protocol';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { BroadcastingStore } from './broadcast-store.js';
import { RunRejected, type RunStarter } from './runs.js';

export interface AppDeps {
  store: BroadcastingStore;
  runs: RunStarter;
}

const StartBody = z.object({
  prompt: z.string().trim().min(1).max(4000),
  mode: z.enum(['demo', 'live']).default('demo'),
});

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

const isTerminal = (event: OrbitEvent) =>
  event.type === 'run.completed' || event.type === 'run.failed';

export function createApp({ store, runs }: AppDeps) {
  const app = new Hono();

  // A web page in the user's browser must not be able to drive this local server through DNS
  // rebinding, so only loopback host names are accepted.
  app.use('*', async (c, next) => {
    if (!LOCAL_HOST.test(c.req.header('host') ?? ''))
      return c.json({ error: 'forbidden host' }, 403);
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/modes', (c) => c.json({ modes: runs.modes() }));

  app.post('/runs', async (c) => {
    // Requiring JSON forces a CORS preflight for cross-site requests, which we never approve.
    if (!c.req.header('content-type')?.startsWith('application/json')) {
      return c.json({ error: 'content-type must be application/json' }, 415);
    }
    const body = StartBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request body' }, 400);

    try {
      return c.json({ runId: runs.start(body.data) }, 201);
    } catch (error) {
      if (error instanceof RunRejected) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.post('/runs/:runId/cancel', (c) => {
    return runs.cancel(c.req.param('runId'))
      ? c.json({ ok: true })
      : c.json({ error: 'run is not running' }, 404);
  });

  app.get('/runs/:runId/events', (c) => {
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return c.json({ error: 'after must be a non-negative integer' }, 400);
    }
    return c.json({ events: store.read(c.req.param('runId'), after) });
  });

  // Replay what already happened, then follow live. `Last-Event-ID` (sent automatically by
  // EventSource when it reconnects) or `?after=` resumes without losing or repeating events.
  app.get('/runs/:runId/stream', (c) => {
    const runId = c.req.param('runId');
    const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return c.json({ error: 'after must be a non-negative integer' }, 400);
    }
    if (store.read(runId, 0).length === 0) return c.json({ error: 'unknown run' }, 404);

    return streamSSE(c, async (stream) => {
      const queue: OrbitEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const push = (event: OrbitEvent) => {
        queue.push(event);
        wake?.();
      };

      // Subscribe before reading, in one synchronous step, so no event falls in between.
      const unsubscribe = store.subscribe(runId, push);
      queue.push(...store.read(runId, after));
      // Leaving only stops the stream; the run itself continues and can be resumed or cancelled.
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });

      try {
        let last = after;
        while (!closed) {
          const event = queue.shift();
          if (!event) {
            await new Promise<void>((resolve) => (wake = resolve));
            wake = null;
            continue;
          }
          if (event.seq <= last) continue;
          last = event.seq;
          await stream.writeSSE({
            id: String(event.seq),
            event: 'orbit',
            data: JSON.stringify(event),
          });
          if (isTerminal(event)) break;
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return app;
}
