import {
  AgentInput,
  ModelInput,
  ModelTestInput,
  type McpStatus,
  type OrbitEvent,
} from '@orbit/protocol';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import { AgentError, type AgentManager } from './agents.js';
import type { ApprovalResolver } from './approvals.js';
import type { BroadcastingStore } from './broadcast-store.js';
import type { ModelManager } from './models.js';
import { SettingsError } from './models.js';
import { WorkspaceError, type WorkspaceManager } from './workspaces.js';
import { RunRejected, type RunStarter } from './runs.js';

export interface AppDeps {
  store: BroadcastingStore;
  runs: RunStarter;
  approvals: ApprovalResolver;
  /** Model settings; absent in tests that do not exercise them. */
  models?: Pick<ModelManager, 'list' | 'save' | 'remove' | 'setDefault' | 'test' | 'balance'>;
  /** The registered workspaces. Absent in tests that do not exercise them. */
  workspaces?: Pick<WorkspaceManager, 'list' | 'pickAndAdd' | 'remove'>;
  /** Agent profiles; absent in tests that do not exercise them. */
  agents?: Pick<AgentManager, 'list' | 'save' | 'remove' | 'tools'>;
  /** The configured MCP servers, read-only. Absent in tests that do not exercise them. */
  mcp?: { status(): McpStatus };
}

const StartBody = z.object({
  prompt: z.string().trim().min(1).max(4000),
  mode: z.enum(['demo', 'live']).default('demo'),
  approval: z.enum(['ask', 'readonly']).default('ask'),
  /** Continue an earlier conversation; omit it to start a new one. */
  sessionId: z.string().min(1).optional(),
  /** A saved model for this run (live mode); omit it for the default. */
  modelId: z.string().min(1).optional(),
  /** An agent profile for this run (live mode); omit it for the built-in agent. */
  agentId: z.string().min(1).optional(),
  /** A registered workspace for a new conversation; an id, never a path. */
  workspaceId: z.string().min(1).optional(),
});

const DefaultBody = z.object({ id: z.string().min(1) });
/** The only thing the page may say about a new workspace: what to call it. */
const PickBody = z.object({ name: z.string().trim().min(1).max(40).optional() }).strict();

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

const Answers = z.object({
  answers: z.record(z.string(), z.enum(['allow', 'deny'])),
});

const Rename = z.object({ title: z.string().trim().min(1).max(80) });
const ForkBody = z.object({ upToRun: z.number().int().min(1) });

const isTerminal = (event: OrbitEvent) =>
  event.type === 'run.completed' || event.type === 'run.failed';

/** Requiring JSON forces a CORS preflight for cross-site requests, which we never approve. */
function requireJson(contentType: string | undefined) {
  return contentType?.startsWith('application/json')
    ? null
    : { body: { error: 'content-type must be application/json' }, status: 415 as const };
}

export function createApp({ store, runs, approvals, models, agents, workspaces, mcp }: AppDeps) {
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

  app.patch('/sessions/:sessionId', async (c) => {
    const notJson = requireJson(c.req.header('content-type'));
    if (notJson) return c.json(notJson.body, notJson.status);
    const body = Rename.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request body' }, 400);
    return runs.rename(c.req.param('sessionId'), body.data.title)
      ? c.json({ ok: true })
      : c.json({ error: 'unknown session' }, 404);
  });

  app.delete('/sessions/:sessionId', (c) => {
    const outcome = runs.remove(c.req.param('sessionId'));
    if (outcome === 'unknown') return c.json({ error: 'unknown session' }, 404);
    if (outcome === 'busy') return c.json({ error: 'stop the run in this session first' }, 409);
    return c.json({ ok: true });
  });

  // The archive: conversations the user removed from the list. They can be brought back, or deleted
  // for good, which also deletes their events (ADR 0015).
  app.get('/archive', (c) => c.json({ sessions: runs.listArchived() }));

  app.post('/archive/:sessionId/restore', (c) =>
    runs.restore(c.req.param('sessionId')) === 'ok'
      ? c.json({ ok: true })
      : c.json({ error: 'unknown archived session' }, 404),
  );

  app.delete('/archive/:sessionId', (c) =>
    runs.purge(c.req.param('sessionId')) === 'ok'
      ? c.json({ ok: true })
      : c.json({ error: 'unknown archived session' }, 404),
  );

  // Start a new conversation from the first `upToRun` runs of this one; the original is untouched.
  app.post('/sessions/:sessionId/fork', async (c) => {
    const notJson = requireJson(c.req.header('content-type'));
    if (notJson) return c.json(notJson.body, notJson.status);
    const body = ForkBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request body' }, 400);
    const outcome = runs.fork(c.req.param('sessionId'), body.data.upToRun);
    if (outcome.status === 'unknown') return c.json({ error: 'unknown session' }, 404);
    if (outcome.status === 'range') return c.json({ error: 'upToRun is out of range' }, 400);
    if (outcome.status === 'busy') return c.json({ error: 'wait for the run to finish' }, 409);
    return c.json({ sessionId: outcome.sessionId }, 201);
  });

  // Undo one file write recorded in a run. Needs JSON like the other state-changing posts.
  app.post('/runs/:runId/changes/:callId/rollback', async (c) => {
    const notJson = requireJson(c.req.header('content-type'));
    if (notJson) return c.json(notJson.body, notJson.status);
    const outcome = await runs.rollback(c.req.param('runId'), c.req.param('callId'));
    switch (outcome.status) {
      case 'ok':
        return c.json({ ok: true });
      case 'unknown':
        return c.json({ error: 'no such change' }, 404);
      case 'already':
        return c.json({ error: 'this change was already undone' }, 409);
      case 'busy':
        return c.json({ error: 'wait until no run is going, then try again' }, 409);
      case 'conflict':
        return c.json({ error: outcome.message }, 409);
    }
  });

  if (workspaces) {
    // Which folders the agent may work in is decided on this machine (ADR 0014). The page can read
    // the list and ask the server to open the operating system's folder dialog, but no request
    // carries a path: the folder is whatever the person at this machine chooses in that dialog.
    app.get('/workspaces', (c) => c.json(workspaces.list()));

    const workspaceFailure = (error: unknown) => {
      if (error instanceof WorkspaceError) return { message: error.message, status: error.status };
      throw error;
    };

    app.post('/workspaces/pick', async (c) => {
      const notJson = requireJson(c.req.header('content-type'));
      if (notJson) return c.json(notJson.body, notJson.status);
      const body = PickBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid request body' }, 400);
      try {
        return c.json(await workspaces.pickAndAdd(body.data.name));
      } catch (error) {
        const failure = workspaceFailure(error);
        return c.json({ error: failure.message }, failure.status);
      }
    });

    app.delete('/workspaces/:id', (c) => {
      try {
        return c.json(workspaces.remove(c.req.param('id')));
      } catch (error) {
        const failure = workspaceFailure(error);
        return c.json({ error: failure.message }, failure.status);
      }
    });
  }

  if (mcp) {
    // Read-only on purpose: a stdio MCP server is a program that starts on this machine, so the
    // list can only be changed by editing mcp.json by hand (ADR 0008). There is no write route.
    app.get('/mcp', (c) => c.json(mcp.status()));
  }

  if (models) {
    // Keys are write-only: no response here ever contains one.
    app.get('/settings/models', (c) => c.json(models.list()));

    // Run a change that may be refused (bad URL, missing key, unknown model) as a 400.
    const attempt = (fn: () => unknown) => {
      try {
        return { value: fn() };
      } catch (error) {
        if (error instanceof SettingsError) return { error: error.message };
        throw error;
      }
    };

    app.post('/settings/models', async (c) => {
      const notJson = requireJson(c.req.header('content-type'));
      if (notJson) return c.json(notJson.body, notJson.status);
      const body = ModelInput.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid request body' }, 400);
      const result = attempt(() => models.save(undefined, body.data));
      return result.error ? c.json({ error: result.error }, 400) : c.json(result.value, 201);
    });

    app.put('/settings/models/:id', async (c) => {
      const notJson = requireJson(c.req.header('content-type'));
      if (notJson) return c.json(notJson.body, notJson.status);
      const body = ModelInput.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid request body' }, 400);
      const result = attempt(() => models.save(c.req.param('id'), body.data));
      return result.error ? c.json({ error: result.error }, 400) : c.json(result.value);
    });

    app.delete('/settings/models/:id', (c) => {
      const result = attempt(() => models.remove(c.req.param('id')));
      return result.error ? c.json({ error: result.error }, 404) : c.json(result.value);
    });

    app.put('/settings/default-model', async (c) => {
      const notJson = requireJson(c.req.header('content-type'));
      if (notJson) return c.json(notJson.body, notJson.status);
      const body = DefaultBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid request body' }, 400);
      const result = attempt(() => models.setDefault(body.data.id));
      return result.error ? c.json({ error: result.error }, 404) : c.json(result.value);
    });

    // The provider's account balance for one model (`?model=<id>`, default if omitted). It asks
    // with the saved key on the server; the answer holds numbers and a message, never the key.
    app.get('/settings/balance', async (c) =>
      c.json(await models.balance(c.req.query('model'), c.req.query('refresh') === '1')),
    );

    app.post('/settings/models/test', async (c) => {
      const notJson = requireJson(c.req.header('content-type'));
      if (notJson) return c.json(notJson.body, notJson.status);
      const body = ModelTestInput.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid request body' }, 400);
      try {
        return c.json(await models.test(body.data));
      } catch (error) {
        if (error instanceof SettingsError) return c.json({ error: error.message }, 400);
        throw error;
      }
    });
  }

  if (agents) {
    app.get('/agents', (c) => c.json(agents.list()));
    app.get('/agents/tools', (c) => c.json({ tools: agents.tools() }));

    const attempt = (fn: () => unknown) => {
      try {
        return { value: fn() };
      } catch (error) {
        if (error instanceof AgentError) return { error: error.message };
        throw error;
      }
    };

    app.post('/agents', async (c) => {
      const notJson = requireJson(c.req.header('content-type'));
      if (notJson) return c.json(notJson.body, notJson.status);
      const body = AgentInput.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid request body' }, 400);
      const result = attempt(() => agents.save(undefined, body.data));
      return result.error ? c.json({ error: result.error }, 400) : c.json(result.value, 201);
    });

    app.put('/agents/:id', async (c) => {
      const notJson = requireJson(c.req.header('content-type'));
      if (notJson) return c.json(notJson.body, notJson.status);
      const body = AgentInput.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'invalid request body' }, 400);
      const result = attempt(() => agents.save(c.req.param('id'), body.data));
      return result.error ? c.json({ error: result.error }, 400) : c.json(result.value);
    });

    app.delete('/agents/:id', (c) => {
      const result = attempt(() => agents.remove(c.req.param('id')));
      return result.error ? c.json({ error: result.error }, 400) : c.json(result.value);
    });
  }

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
