import { projectRun } from '@orbit/core';
import type { OrbitEvent, SessionStatus, SessionSummary } from '@orbit/protocol';

const TITLE_CHARS = 40;
const SNIPPET_CHARS = 80;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The words the agent said after its last tool call, i.e. its answer rather than its narration. */
function lastAnswer(events: readonly OrbitEvent[]): string {
  let answer = '';
  for (const event of events) {
    if (event.type === 'tool.requested') answer = '';
    else if (event.type === 'message.delta') answer += event.text;
  }
  return answer;
}

export function summarizeSession(
  sessionId: string,
  runs: readonly (readonly OrbitEvent[])[],
): SessionSummary {
  const first = runs[0] ? projectRun(runs[0]) : null;
  const lastEvents = runs.at(-1) ?? [];
  const last = projectRun(lastEvents);

  const waiting = last.toolCalls.some((call) => call.status === 'awaiting');
  let status: SessionStatus = 'idle';
  if (last.status === 'running') status = waiting ? 'awaiting' : 'running';
  // A run the user stopped is not an error worth flagging in the list.
  else if (last.status === 'failed' && last.failureReason !== 'cancelled') status = 'failed';

  return {
    sessionId,
    title: first?.prompt ? clip(oneLine(first.prompt), TITLE_CHARS) : '新会话',
    snippet: clip(oneLine(lastAnswer(lastEvents)), SNIPPET_CHARS),
    runCount: runs.length,
    status,
    updatedAt: lastEvents.at(-1)?.ts ?? 0,
  };
}
