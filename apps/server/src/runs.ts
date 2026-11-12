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
  info(): Omit<ServerInfo, 'modes'>;
}

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
  /** Absent when no model credentials are configured. */
  liveLlm?: LlmClient;
  /** Where sessions are kept. Defaults to memory, which is lost on restart. */
  sessions?: SessionStore;
  /** Name of the live model, shown in the UI. */
  liveModel?: string;
  /** Decides which tool calls run, wait for the user, or are refused. */
  policy?: Policy;
  /** Asked for the calls the policy leaves to the user. */
  approver?: Approver;
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
  /** Which runs belong to which session. The conversation itself lives in the event logs. */
  private readonly sessions: SessionStore;

  constructor(private readonly options: RunManagerOptions) {
    this.sessions = options.sessions ?? new InMemorySessionStore();
  }

  modes(): RunMode[] {
    return this.options.liveLlm ? ['demo', 'live'] : ['demo'];
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
    const llm = mode === 'live' ? this.options.liveLlm : this.options.demoLlm;
    if (!llm) throw new RunRejected('live mode is not configured on this server', 400);

    // A client cannot invent a session id: only ids this server handed out are accepted.
    const existing = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (sessionId !== undefined && !existing) throw new RunRejected('unknown session', 404);
    const previousRuns = existing?.runIds ?? [];
    if ([...this.active.values()].some((run) => run.sessionId === sessionId)) {
      throw new RunRejected('this session already has a run in progress', 409);
    }
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

  info(): Omit<ServerInfo, 'modes'> {
    return {
      workspace: this.options.workspace,
      workspaceName: path.basename(this.options.workspace) || this.options.workspace,
      liveModel: this.options.liveLlm ? (this.options.liveModel ?? null) : null,
    };
  }

  cancel(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }
}
