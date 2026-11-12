import type { OrbitEvent } from '@orbit/protocol';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { ApprovalResolver } from './approvals.js';
import type { BroadcastingStore } from './broadcast-store.js';
import { RunRejected, type RunStarter } from './runs.js';

export interface AppDeps {
  store: BroadcastingStore;
  runs: RunStarter;
  approvals: ApprovalResolver;
}

const StartBody = z.object({
  prompt: z.string().trim().min(1).max(4000),
  mode: z.enum(['demo', 'live']).default('demo'),
  approval: z.enum(['ask', 'readonly']).default('ask'),
  /** Continue an earlier conversation; omit it to start a new one. */
  sessionId: z.string().min(1).optional(),
});

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

const Answers = z.object({
  answers: z.record(z.string(), z.enum(['allow', 'deny'])),
});

const isTerminal = (event: OrbitEvent) =>
  event.type === 'run.completed' || event.type === 'run.failed';

/** Requiring JSON forces a CORS preflight for cross-site requests, which we never approve. */
function requireJson(contentType: string | undefined) {
  return contentType?.startsWith('application/json')
    ? null
    : { body: { error: 'content-type must be application/json' }, status: 415 as const };
}

export function createApp({ store, runs, approvals }: AppDeps) {
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

  app.get('/info', (c) => c.json({ ...runs.info(), modes: runs.modes() }));

  app.get('/sessions', (c) => c.json({ sessions: runs.listSessions() }));

  // The run ids of one conversation; the client replays each run's events to rebuild the screen.
  app.get('/sessions/:sessionId', (c) => {
    const runIds = runs.sessionRuns(c.req.param('sessionId'));
    return runIds
      ? c.json({ sessionId: c.req.param('sessionId'), runIds })
      : c.json({ error: 'unknown session' }, 404);
  });

  app.post('/runs', async (c) => {
    const notJson = requireJson(c.req.header('content-type'));
    if (notJson) return c.json(notJson.body, notJson.status);
    const body = StartBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request body' }, 400);

    try {
      return c.json(runs.start(body.data), 201);
    } catch (error) {
      if (error instanceof RunRejected) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  // The user's answer to a pending approval. Anything not explicitly allowed counts as refused.
  app.post('/runs/:runId/approvals/:approvalId', async (c) => {
    const notJson = requireJson(c.req.header('content-type'));
    if (notJson) return c.json(notJson.body, notJson.status);
    const body = Answers.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request body' }, 400);

    const outcome = approvals.resolve(
      c.req.param('runId'),
      c.req.param('approvalId'),
      body.data.answers,
    );
    if (outcome === 'unknown') return c.json({ error: 'no such pending approval' }, 404);
    if (outcome === 'invalid') return c.json({ error: 'answers name unknown calls' }, 400);
    return c.json({ ok: true });
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
