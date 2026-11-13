import path from 'node:path';

import {
  DEFAULT_SYSTEM_PROMPT,
  historyFromRuns,
  InMemorySessionStore,
  readOnlyPolicy,
  runAgent,
  type Approver,
  type EventStore,
  type LlmClient,
  type Policy,
  type SessionStore,
  type ToolRegistry,
} from '@orbit/core';
import { RollbackConflict } from '@orbit/tools';

import type { ServerInfo, SessionSummary } from '@orbit/protocol';

import { summarizeSession } from './session-summary.js';

export type RunMode = 'demo' | 'live';

/** Who decides on writes: the user is asked each turn, or writing is refused outright. */
export type ApprovalMode = 'ask' | 'readonly';

/** What the HTTP layer needs from the thing that runs agents. */
export interface RunStarter {
  /** Modes that can be started right now ("live" needs model credentials). */
  modes(): RunMode[];
  /**
   * Start a run and return its id. Without a `sessionId` a new conversation begins; with one, the
   * run continues that conversation and sees its earlier turns. Throws RunRejected when it cannot
   * be started.
   */
  start(request: {
    prompt: string;
    mode: RunMode;
    approval?: ApprovalMode | undefined;
    sessionId?: string | undefined;
  }): {
    runId: string;
    sessionId: string;
  };
  /** Abort a running run. Returns false when it is not running. */
  cancel(runId: string): boolean;
  /** Conversations, most recently active first. */
  listSessions(): SessionSummary[];
  /** The run ids of a session, oldest first; undefined for an unknown session. */
  sessionRuns(sessionId: string): string[] | undefined;
  /** Give a session a title of the user's choosing. False for an unknown session. */
  rename(sessionId: string, title: string): boolean;
  /** Hide a session; its events stay. `busy` while a run of it is going. */
  remove(sessionId: string): 'ok' | 'unknown' | 'busy';
  /**
   * Undo one file write of a finished run. Only when nothing is running, because a run could be
   * writing the same files; `conflict` when the file no longer holds what the agent wrote.
   */
  rollback(runId: string, callId: string): Promise<RollbackOutcome>;
  /**
   * Start a new conversation holding the first `upToRun` runs (1-based) of an existing one, so the
   * user can take a different direction from there. The original is not touched.
   */
  fork(sessionId: string, upToRun: number): ForkOutcome;
  info(): Omit<ServerInfo, 'modes'>;
}

export type RollbackOutcome =
  | { status: 'ok' }
  | { status: 'unknown' }
  | { status: 'already' }
  | { status: 'busy' }
  | { status: 'conflict'; message: string };

export type ForkOutcome =
  | { status: 'ok'; sessionId: string }
  | { status: 'unknown' }
  | { status: 'range' }
  | { status: 'busy' };

export class RunRejected extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429,
  ) {
    super(message);
    this.name = 'RunRejected';
  }
}

export interface RunManagerOptions {
  store: EventStore;
  registry: ToolRegistry;
  workspace: string;
  demoLlm: LlmClient;
  /** The model for live mode right now; asked on every call so saved settings apply at once. */
  live?: () => { llm: LlmClient; name: string } | undefined;
  /** Where sessions are kept. Defaults to memory, which is lost on restart. */
  sessions?: SessionStore;
  /** Decides which tool calls run, wait for the user, or are refused. */
  policy?: Policy;
  /** Asked for the calls the policy leaves to the user. */
  approver?: Approver;
  /** Undoes a recorded write on disk; throws RollbackConflict when the file has moved on. */
  rollback?: (change: { path: string; before: string | null; after: string }) => Promise<void>;
  newId?: () => string;
  newSessionId?: () => string;
  /** Runs allowed at once; protects the machine and the model quota. */
  maxActive?: number;
}

interface ActiveRun {
  controller: AbortController;
  sessionId: string;
}

export class RunManager implements RunStarter {
  private readonly active = new Map<string, ActiveRun>();
  private rollingBack = false;
  /** Which runs belong to which session. The conversation itself lives in the event logs. */
  private readonly sessions: SessionStore;

  constructor(private readonly options: RunManagerOptions) {
    this.sessions = options.sessions ?? new InMemorySessionStore();
  }

  modes(): RunMode[] {
    return this.options.live?.() ? ['demo', 'live'] : ['demo'];
  }

  start({
    prompt,
    mode,
    approval = 'ask',
    sessionId,
  }: {
    prompt: string;
    mode: RunMode;
    approval?: ApprovalMode | undefined;
    sessionId?: string | undefined;
  }): {
    runId: string;
    sessionId: string;
  } {
    const llm = mode === 'live' ? this.options.live?.()?.llm : this.options.demoLlm;
    if (!llm) throw new RunRejected('live mode is not configured on this server', 400);

    // A client cannot invent a session id: only ids this server handed out are accepted.
    const existing = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (sessionId !== undefined && !existing) throw new RunRejected('unknown session', 404);
    const previousRuns = existing?.runIds ?? [];
    if ([...this.active.values()].some((run) => run.sessionId === sessionId)) {
      throw new RunRejected('this session already has a run in progress', 409);
    }
    if (this.rollingBack) throw new RunRejected('a rollback is in progress, try again', 409);
    if (this.active.size >= (this.options.maxActive ?? 4)) {
      throw new RunRejected('too many runs in progress', 429);
    }

    const session = sessionId ?? (this.options.newSessionId ?? (() => crypto.randomUUID()))();
    const runId = (this.options.newId ?? (() => crypto.randomUUID()))();
    const history = historyFromRuns(previousRuns.map((id) => this.options.store.read(id)));
    if (!existing) this.sessions.create(session);
    this.sessions.addRun(session, runId);

    const controller = new AbortController();
    this.active.set(runId, { controller, sessionId: session });

    // Not awaited: the run reports through the event log. runAgent appends run.started
    // synchronously, so the log exists by the time this method returns.
    void runAgent({
      runId,
      agentId: mode === 'live' ? 'orbit-default' : 'orbit-demo',
      workspace: this.options.workspace,
      llm,
      store: this.options.store,
      registry: this.options.registry,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      prompt,
      history,
      // "readonly" refuses every write without asking; otherwise the configured policy decides.
      ...(approval === 'readonly'
        ? { policy: readOnlyPolicy }
        : this.options.policy
          ? { policy: this.options.policy }
          : {}),
      ...(this.options.approver ? { approver: this.options.approver } : {}),
      signal: controller.signal,
    })
      .catch((error: unknown) => {
        console.error('run crashed:', error instanceof Error ? error.message : String(error));
      })
      .finally(() => this.active.delete(runId));
    return { runId, sessionId: session };
  }

  listSessions(): SessionSummary[] {
    return this.sessions
      .list()
      .map((record) =>
        summarizeSession(
          record.sessionId,
          record.runIds.map((runId) => this.options.store.read(runId)),
          record.title,
        ),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  sessionRuns(sessionId: string): string[] | undefined {
    return this.sessions.get(sessionId)?.runIds;
  }

  rename(sessionId: string, title: string): boolean {
    return this.sessions.rename(sessionId, title);
  }

  remove(sessionId: string): 'ok' | 'unknown' | 'busy' {
    if (!this.sessions.get(sessionId)) return 'unknown';
    // A run that is still going would write into a conversation nobody can see any more.
    if ([...this.active.values()].some((run) => run.sessionId === sessionId)) return 'busy';
    return this.sessions.remove(sessionId) ? 'ok' : 'unknown';
  }

  async rollback(runId: string, callId: string): Promise<RollbackOutcome> {
    const undo = this.options.rollback;
    const events = this.options.store.read(runId);
    const changed = events.find((e) => e.type === 'file.changed' && e.callId === callId);
    if (!undo || changed?.type !== 'file.changed') return { status: 'unknown' };
    if (events.some((e) => e.type === 'file.rolledback' && e.callId === callId)) {
      return { status: 'already' };
    }
    // A running agent may be writing the same files, and two rollbacks could race on one file.
    if (this.active.size > 0 || this.rollingBack) return { status: 'busy' };

    this.rollingBack = true;
    try {
      await undo({ path: changed.path, before: changed.before, after: changed.after });
    } catch (error) {
      if (error instanceof RollbackConflict) {
        return {
          status: 'conflict',
          message: `${error.message}。如果同一个文件被改过多次，请先撤销更晚的修改。`,
        };
      }
      throw error;
    } finally {
      this.rollingBack = false;
    }
    this.options.store.append(runId, { type: 'file.rolledback', callId, path: changed.path });
    return { status: 'ok' };
  }

  fork(sessionId: string, upToRun: number): ForkOutcome {
    const record = this.sessions.get(sessionId);
    if (!record) return { status: 'unknown' };
    if (!Number.isInteger(upToRun) || upToRun < 1 || upToRun > record.runIds.length) {
      return { status: 'range' };
    }
    const source = record.runIds.slice(0, upToRun);
    if (source.some((runId) => this.active.has(runId))) return { status: 'busy' };

    const logs = source.map((runId) => this.options.store.read(runId));
    const title = summarizeSession(sessionId, logs, record.title).title;
    const forked = (this.options.newSessionId ?? (() => crypto.randomUUID()))();
    this.sessions.create(forked);
    for (const log of logs) {
      const copy = (this.options.newId ?? (() => crypto.randomUUID()))();
      for (const event of log) {
        // What the agent said and did is copied. Changes to files are not: the workspace is not
        // forked, so the copy must not offer to undo writes that belong to the original.
        if (event.type === 'file.changed' || event.type === 'file.rolledback') continue;
        const { id: _id, runId: _runId, seq: _seq, ts: _ts, ...draft } = event;
        this.options.store.append(copy, draft);
      }
      this.sessions.addRun(forked, copy);
    }
    this.sessions.rename(forked, `分叉 · ${title}`.slice(0, 80));
    return { status: 'ok', sessionId: forked };
  }

  info(): Omit<ServerInfo, 'modes'> {
    return {
      workspace: this.options.workspace,
      workspaceName: path.basename(this.options.workspace) || this.options.workspace,
      liveModel: this.options.live?.()?.name ?? null,
    };
  }

  cancel(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }
}
