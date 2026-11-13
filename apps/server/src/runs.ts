import path from 'node:path';

import {
  buildSystemPrompt,
  historyFromRuns,
  InMemorySessionStore,
  projectRun,
  readOnlyPolicy,
  runAgent,
  type Approver,
  type EventStore,
  type LlmClient,
  type Policy,
  type SessionRecord,
  type SessionStore,
  type ToolRegistry,
} from '@orbit/core';
import { RollbackConflict } from '@orbit/tools';

import type { ServerInfo, SessionSummary } from '@orbit/protocol';

import type { ResolvedAgent } from './agents.js';
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
    /** A saved model for live mode; the agent's, else the default, when omitted. */
    modelId?: string | undefined;
    /** An agent profile for live mode; the built-in agent when omitted. */
    agentId?: string | undefined;
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
  /** Archive a session: hidden from the list, nothing deleted. `busy` while a run of it is going. */
  remove(sessionId: string): 'ok' | 'unknown' | 'busy';
  /** The archived sessions, most recently active first. */
  listArchived(): SessionSummary[];
  /** Bring an archived session back into the list. */
  restore(sessionId: string): 'ok' | 'unknown';
  /** Delete an archived session and all its events for good (ADR 0015). Cannot be undone. */
  purge(sessionId: string): 'ok' | 'unknown';
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

type Rollback = (change: { path: string; before: string | null; after: string }) => Promise<void>;

/** A folder a run works in, with the tools and rollback that are confined to it. */
export interface RunWorkspace {
  id: string;
  name: string;
  path: string;
  registry: ToolRegistry;
  rollback?: Rollback | undefined;
}

/** Where runs get their workspace from. The server decides which exist; a run only names an id. */
export interface WorkspaceSource {
  primary(): RunWorkspace;
  resolve(id?: string): RunWorkspace | undefined;
  /** The workspace a stored run belongs to, found by the path its run.started recorded. */
  byPath(path: string): RunWorkspace | undefined;
}

export interface RunManagerOptions {
  store: EventStore;
  registry: ToolRegistry;
  /** Agent profiles; without it every run uses the built-in agent. */
  agents?: { resolve(id?: string): ResolvedAgent | undefined };
  /** The only workspace, used when `workspaces` is not given (and as its primary one). */
  workspace: string;
  /** All registered workspaces; without it every run uses `workspace` and `registry`. */
  workspaces?: WorkspaceSource;
  demoLlm: LlmClient;
  /** The model for live mode right now; asked on every call so saved settings apply at once. */
  live?: (
    modelId?: string,
  ) => { llm: LlmClient; name: string; contextWindow?: number | null } | undefined;
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

  private readonly workspaces: WorkspaceSource;

  constructor(private readonly options: RunManagerOptions) {
    this.sessions = options.sessions ?? new InMemorySessionStore();
    const only: RunWorkspace = {
      id: 'primary',
      name: path.basename(options.workspace) || options.workspace,
      path: options.workspace,
      registry: options.registry,
      rollback: options.rollback,
    };
    this.workspaces = options.workspaces ?? {
      primary: () => only,
      resolve: (id) => (id === undefined || id === only.id ? only : undefined),
      byPath: () => only,
    };
  }

  modes(): RunMode[] {
    return this.options.live?.() ? ['demo', 'live'] : ['demo'];
  }

  start({
    prompt,
    mode,
    approval = 'ask',
    sessionId,
    modelId,
    agentId,
    workspaceId,
  }: {
    prompt: string;
    mode: RunMode;
    approval?: ApprovalMode | undefined;
    sessionId?: string | undefined;
    modelId?: string | undefined;
    agentId?: string | undefined;
    workspaceId?: string | undefined;
  }): {
    runId: string;
    sessionId: string;
  } {
    // An agent profile (live mode only) picks a model and narrows the tools. An explicit model
    // wins over the agent's; an agent whose model was since deleted falls back to the default.
    const agent = mode === 'live' ? this.options.agents?.resolve(agentId) : undefined;
    if (mode === 'live' && agentId !== undefined && !agent) {
      throw new RunRejected('unknown agent', 400);
    }
    if (mode === 'live' && modelId !== undefined && !this.options.live?.(modelId)) {
      throw new RunRejected('unknown model', 400);
    }
    const wanted = modelId ?? agent?.modelId ?? undefined;
    const live =
      mode === 'live' ? (this.options.live?.(wanted) ?? this.options.live?.()) : undefined;
    const llm = mode === 'live' ? live?.llm : this.options.demoLlm;
    if (!llm) throw new RunRejected('live mode is not configured on this server', 400);

    // A client cannot invent a session id: only ids this server handed out are accepted.
    const existing = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (sessionId !== undefined && !existing) throw new RunRejected('unknown session', 404);
    const previousRuns = existing?.runIds ?? [];
    // A conversation keeps the workspace its first run recorded; a new one takes the id asked for
    // (or the default). The id must be one the server registered: a path is never accepted.
    let workspace: RunWorkspace | undefined;
    const firstRun = previousRuns[0];
    if (firstRun !== undefined) {
      const recorded = projectRun(this.options.store.read(firstRun)).workspace;
      workspace = recorded === null ? undefined : this.workspaces.byPath(recorded);
      if (!workspace) {
        throw new RunRejected('the workspace of this conversation is no longer registered', 409);
      }
      if (workspaceId !== undefined && workspaceId !== workspace.id) {
        throw new RunRejected('a conversation keeps its workspace', 400);
      }
    } else {
      workspace = this.workspaces.resolve(workspaceId);
      if (!workspace) throw new RunRejected('unknown workspace', 400);
    }
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
    // `report` stays for every agent when the server has it (ADR 0007); and the prompt asks for a
    // report only when the run can make one.
    const runRegistry = agent?.tools
      ? workspace.registry.pick([...agent.tools, 'report'])
      : workspace.registry;
    const basePrompt = buildSystemPrompt({ report: runRegistry.get('report') !== undefined });
    void runAgent({
      runId,
      agentId:
        mode !== 'live' ? 'orbit-demo' : agent && !agent.builtin ? agent.id : 'orbit-default',
      ...(agent && !agent.builtin ? { agentName: agent.name } : {}),
      ...(live ? { modelName: live.name } : {}),
      ...(live?.contextWindow ? { contextWindow: live.contextWindow } : {}),
      workspace: workspace.path,
      llm,
      store: this.options.store,
      registry: runRegistry,
      systemPrompt: agent?.instructions
        ? `${basePrompt}\n\nAdditional instructions from the user for this agent:\n${agent.instructions}`
        : basePrompt,
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

  private summarize(record: SessionRecord): SessionSummary {
    const summary = summarizeSession(
      record.sessionId,
      record.runIds.map((runId) => this.options.store.read(runId)),
      record.title,
    );
    const registered = summary.workspace ? this.workspaces.byPath(summary.workspace) : undefined;
    // A registered workspace is shown by its canonical path and name, so old logs that recorded
    // the same folder in another spelling land in the same group.
    return registered
      ? { ...summary, workspace: registered.path, workspaceName: registered.name }
      : summary;
  }

  listSessions(): SessionSummary[] {
    return this.sessions
      .list()
      .map((record) => this.summarize(record))
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

  listArchived(): SessionSummary[] {
    return this.sessions
      .listRemoved()
      .map((record) => this.summarize(record))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  restore(sessionId: string): 'ok' | 'unknown' {
    return this.sessions.restore(sessionId) ? 'ok' : 'unknown';
  }

  purge(sessionId: string): 'ok' | 'unknown' {
    const record = this.sessions.listRemoved().find((r) => r.sessionId === sessionId);
    if (!record) return 'unknown';
    // Events first: the database only allows deleting them while the conversation is still in the
    // archive. If this is cut short the archived conversation stays, emptied, and can be purged again.
    this.options.store.deleteRuns(record.runIds);
    return this.sessions.purge(sessionId) ? 'ok' : 'unknown';
  }

  async rollback(runId: string, callId: string): Promise<RollbackOutcome> {
    const events = this.options.store.read(runId);
    const started = events.find((e) => e.type === 'run.started');
    // The undo is confined to the workspace the run worked in.
    const undo =
      started?.type === 'run.started'
        ? this.workspaces.byPath(started.workspace)?.rollback
        : undefined;
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
      workspace: this.workspaces.primary().path,
      workspaceName: this.workspaces.primary().name,
      liveModel: this.options.live?.()?.name ?? null,
      report: this.workspaces.primary().registry.get('report') !== undefined,
    };
  }

  cancel(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }
}
