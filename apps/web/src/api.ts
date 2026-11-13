import {
  AgentList,
  ForkResult,
  McpStatus,
  ModelBalance,
  ModelList,
  ModelTestResult,
  OrbitEvent,
  ServerInfo,
  SessionList,
  SessionRuns,
  ToolList,
  WorkspaceAdded,
  WorkspaceList,
  type AgentInput,
  type AgentProfile,
  type WorkspaceInfo,
  type ModelInput,
  type ModelProfile,
  type ModelTestInput,
  type RunMode,
  type SessionSummary,
} from '@orbit/protocol';

export type {
  WorkspaceAdded,
  WorkspaceInfo,
  WorkspaceList,
  AgentList,
  AgentProfile,
  ModelBalance,
  ModelInput,
  ModelList,
  ModelProfile,
  ModelTestResult,
  RunMode,
  ServerInfo,
  SessionSummary,
};
export type { McpStatus };

/** The configured MCP servers. Read-only: the config file is edited by hand. */
export const fetchMcp = (): Promise<McpStatus> =>
  getJson('/api/mcp', (data) => McpStatus.parse(data));

/** Who decides on writes: ask the user each turn, or refuse them outright. */
export type ApprovalMode = 'ask' | 'readonly';

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `request failed (${res.status})`);
}

/** GET a JSON resource; a response that does not match the shared shape is an error. */
async function getJson<T>(url: string, parse: (data: unknown) => T): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await failure(res);
  return parse(await res.json());
}

export const fetchInfo = (): Promise<ServerInfo> =>
  getJson('/api/info', (data) => ServerInfo.parse(data));

export const fetchSessions = async (): Promise<SessionSummary[]> =>
  (await getJson('/api/sessions', (data) => SessionList.parse(data))).sessions;

/** Conversations the user moved out of the list. */
export const fetchArchive = async (): Promise<SessionSummary[]> =>
  (await getJson('/api/archive', (data) => SessionList.parse(data))).sessions;

export async function restoreSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/archive/${encodeURIComponent(sessionId)}/restore`, {
    method: 'POST',
  });
  if (!res.ok) throw await failure(res);
}

/** Delete an archived conversation and everything in it for good. Cannot be undone. */
export async function purgeSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/archive/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res);
}

export const fetchSessionRuns = async (sessionId: string): Promise<string[]> =>
  (
    await getJson(`/api/sessions/${encodeURIComponent(sessionId)}`, (data) =>
      SessionRuns.parse(data),
    )
  ).runIds;

/** The stored events of one run, in order. Anything that is not a valid event is dropped. */
export async function fetchRunEvents(runId: string): Promise<OrbitEvent[]> {
  const { events } = await getJson(
    `/api/runs/${encodeURIComponent(runId)}/events`,
    (data) =>
      data as {
        events: unknown[];
      },
  );
  return events.flatMap((event) => {
    const parsed = OrbitEvent.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface StartedRun {
  runId: string;
  sessionId: string;
}

/** Start a run. Pass the `sessionId` of an earlier answer to continue that conversation. */
export async function startRun(
  prompt: string,
  mode: RunMode,
  approval: ApprovalMode,
  sessionId?: string,
  modelId?: string,
  agentId?: string,
  workspaceId?: string,
): Promise<StartedRun> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      mode,
      approval,
      ...(sessionId ? { sessionId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    }),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as StartedRun;
}

export async function cancelRun(runId: string): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
  if (!res.ok && res.status !== 404) throw await failure(res);
}

export const streamUrl = (runId: string, after = 0) =>
  `/api/runs/${encodeURIComponent(runId)}/stream${after > 0 ? `?after=${after}` : ''}`;

export type Answers = Record<string, 'allow' | 'deny'>;

export async function submitApproval(
  runId: string,
  approvalId: string,
  answers: Answers,
): Promise<void> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
    },
  );
  if (!res.ok) throw await failure(res);
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await failure(res);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res);
}

const sendJson = (method: string, url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const fetchModels = (): Promise<ModelList> =>
  getJson('/api/settings/models', (data) => ModelList.parse(data));

/** Add a model (no `id`) or change one. Resolves with the whole list as the server now has it. */
export async function saveModel(id: string | null, input: ModelInput): Promise<ModelList> {
  const res =
    id === null
      ? await sendJson('POST', '/api/settings/models', input)
      : await sendJson('PUT', `/api/settings/models/${encodeURIComponent(id)}`, input);
  if (!res.ok) throw await failure(res);
  return ModelList.parse(await res.json());
}

export async function removeModel(id: string): Promise<ModelList> {
  const res = await sendJson('DELETE', `/api/settings/models/${encodeURIComponent(id)}`);
  if (!res.ok) throw await failure(res);
  return ModelList.parse(await res.json());
}

export async function setDefaultModel(id: string): Promise<ModelList> {
  const res = await sendJson('PUT', '/api/settings/default-model', { id });
  if (!res.ok) throw await failure(res);
  return ModelList.parse(await res.json());
}

export async function testModel(input: ModelTestInput): Promise<ModelTestResult> {
  const res = await sendJson('POST', '/api/settings/models/test', input);
  if (!res.ok) throw await failure(res);
  return ModelTestResult.parse(await res.json());
}

/** Undo one file write recorded in a run. Rejects with the server's reason (for example a conflict). */
export async function rollbackChange(runId: string, callId: string): Promise<void> {
  const res = await sendJson(
    'POST',
    `/api/runs/${encodeURIComponent(runId)}/changes/${encodeURIComponent(callId)}/rollback`,
    {},
  );
  if (!res.ok) throw await failure(res);
}

/** Start a new conversation from the first `upToRun` runs of an existing one; returns its id. */
export async function forkSession(sessionId: string, upToRun: number): Promise<string> {
  const res = await sendJson('POST', `/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
    upToRun,
  });
  if (!res.ok) throw await failure(res);
  return ForkResult.parse(await res.json()).sessionId;
}

/**
 * The provider's account balance for one model (the default if `modelId` is omitted). `force` asks
 * the provider again instead of reusing a recent answer.
 */
export const fetchBalance = (modelId?: string, force = false): Promise<ModelBalance> => {
  const query = new URLSearchParams();
  if (modelId) query.set('model', modelId);
  if (force) query.set('refresh', '1');
  const text = query.toString();
  return getJson(`/api/settings/balance${text ? `?${text}` : ''}`, (data) =>
    ModelBalance.parse(data),
  );
};

export const fetchAgents = (): Promise<AgentList> =>
  getJson('/api/agents', (data) => AgentList.parse(data));

/** The tools an agent can be given (including those from MCP servers). */
export const fetchTools = (): Promise<ToolList> =>
  getJson('/api/agents/tools', (data) => ToolList.parse(data));

/** Add an agent (`id` null) or change one. Resolves with the whole list as the server now has it. */
export async function saveAgent(id: string | null, input: AgentInput): Promise<AgentList> {
  const res =
    id === null
      ? await sendJson('POST', '/api/agents', input)
      : await sendJson('PUT', `/api/agents/${encodeURIComponent(id)}`, input);
  if (!res.ok) throw await failure(res);
  return AgentList.parse(await res.json());
}

export async function removeAgent(id: string): Promise<AgentList> {
  const res = await sendJson('DELETE', `/api/agents/${encodeURIComponent(id)}`);
  if (!res.ok) throw await failure(res);
  return AgentList.parse(await res.json());
}

/** The folders the agent may work in. Only the server decides this list; the page can only choose. */
export const fetchWorkspaces = (): Promise<WorkspaceList> =>
  getJson('/api/workspaces', (data) => WorkspaceList.parse(data));

/**
 * Ask the server to open the operating system's folder dialog and register the folder the user
 * chooses. The page sends only an optional name, never a path. Resolves when the dialog is closed;
 * `added` is null if the user cancelled.
 */
export async function pickWorkspace(name?: string): Promise<WorkspaceAdded> {
  const res = await sendJson('POST', '/api/workspaces/pick', name ? { name } : {});
  if (!res.ok) throw await failure(res);
  return WorkspaceAdded.parse(await res.json());
}

/** Forget a workspace. Its folder and conversations are untouched. */
export async function removeWorkspace(id: string): Promise<WorkspaceList> {
  const res = await sendJson('DELETE', `/api/workspaces/${encodeURIComponent(id)}`);
  if (!res.ok) throw await failure(res);
  return WorkspaceList.parse(await res.json());
}
