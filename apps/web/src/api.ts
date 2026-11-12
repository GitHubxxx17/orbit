export type RunMode = 'demo' | 'live';

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `request failed (${res.status})`);
}

export async function fetchModes(): Promise<RunMode[]> {
  const res = await fetch('/api/modes');
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { modes: RunMode[] };
  return body.modes;
}

export interface StartedRun {
  runId: string;
  sessionId: string;
}

/** Start a run. Pass the `sessionId` of an earlier answer to continue that conversation. */
export async function startRun(
  prompt: string,
  mode: RunMode,
  sessionId?: string,
): Promise<StartedRun> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, mode, ...(sessionId ? { sessionId } : {}) }),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as StartedRun;
}

export async function cancelRun(runId: string): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
  if (!res.ok && res.status !== 404) throw await failure(res);
}

export const streamUrl = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/stream`;

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
