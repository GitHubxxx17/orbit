import {
  OrbitEvent,
  ServerInfo,
  SessionList,
  SessionRuns,
  type RunMode,
  type SessionSummary,
} from '@orbit/protocol';

export type { RunMode, ServerInfo, SessionSummary };

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
): Promise<StartedRun> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, mode, approval, ...(sessionId ? { sessionId } : {}) }),
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
