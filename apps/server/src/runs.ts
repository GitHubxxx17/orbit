import {
  DEFAULT_SYSTEM_PROMPT,
  historyFromRuns,
  runAgent,
  type Approver,
  type EventStore,
  type LlmClient,
  type Policy,
  type ToolRegistry,
} from '@orbit/core';

export type RunMode = 'demo' | 'live';

/** What the HTTP layer needs from the thing that runs agents. */
export interface RunStarter {
  /** Modes that can be started right now ("live" needs model credentials). */
  modes(): RunMode[];
  /**
   * Start a run and return its id. Without a `sessionId` a new conversation begins; with one, the
   * run continues that conversation and sees its earlier turns. Throws RunRejected when it cannot
   * be started.
   */
  start(request: { prompt: string; mode: RunMode; sessionId?: string | undefined }): {
    runId: string;
    sessionId: string;
  };
  /** Abort a running run. Returns false when it is not running. */
  cancel(runId: string): boolean;
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
  /** Session id -> ids of its runs, oldest first. The conversation itself lives in the event logs. */
  private readonly sessions = new Map<string, string[]>();

  constructor(private readonly options: RunManagerOptions) {}

  modes(): RunMode[] {
    return this.options.liveLlm ? ['demo', 'live'] : ['demo'];
  }

  start({
    prompt,
    mode,
    sessionId,
  }: {
    prompt: string;
    mode: RunMode;
    sessionId?: string | undefined;
  }): {
    runId: string;
    sessionId: string;
  } {
    const llm = mode === 'live' ? this.options.liveLlm : this.options.demoLlm;
    if (!llm) throw new RunRejected('live mode is not configured on this server', 400);

    // A client cannot invent a session id: only ids this server handed out are accepted.
    const previousRuns = sessionId === undefined ? [] : this.sessions.get(sessionId);
    if (!previousRuns) throw new RunRejected('unknown session', 404);
    if ([...this.active.values()].some((run) => run.sessionId === sessionId)) {
      throw new RunRejected('this session already has a run in progress', 409);
    }
    if (this.active.size >= (this.options.maxActive ?? 4)) {
      throw new RunRejected('too many runs in progress', 429);
    }

    const session = sessionId ?? (this.options.newSessionId ?? (() => crypto.randomUUID()))();
    const runId = (this.options.newId ?? (() => crypto.randomUUID()))();
    const history = historyFromRuns(previousRuns.map((id) => this.options.store.read(id)));
    this.sessions.set(session, [...previousRuns, runId]);

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
      ...(this.options.policy ? { policy: this.options.policy } : {}),
      ...(this.options.approver ? { approver: this.options.approver } : {}),
      signal: controller.signal,
    })
      .catch((error: unknown) => {
        console.error('run crashed:', error instanceof Error ? error.message : String(error));
      })
      .finally(() => this.active.delete(runId));
    return { runId, sessionId: session };
  }

  cancel(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }
}
