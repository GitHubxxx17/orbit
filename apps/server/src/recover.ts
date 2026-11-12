import { projectRun, type EventStore, type SessionStore } from '@orbit/core';

const INTERRUPTED = 'interrupted: the server stopped while this run was going';
const UNFINISHED_CALL = 'The server stopped before this call finished.';

/**
 * Close the runs that were still going when the server last stopped. Without this they would look
 * "running" forever. The log stays truthful and consistent: calls that were waiting are recorded
 * as refused, calls that had started are recorded as failed, then the run is recorded as failed.
 * Nothing is rewritten; everything is appended. Returns how many runs were closed.
 */
export function recoverInterruptedRuns(sessions: SessionStore, events: EventStore): number {
  let closed = 0;
  for (const session of sessions.list()) {
    for (const runId of session.runIds) {
      const log = events.read(runId);
      const state = projectRun(log);
      if (state.status !== 'running') continue; // finished, or never started

      for (const call of state.toolCalls) {
        if (call.status === 'requested' || call.status === 'awaiting') {
          events.append(runId, {
            type: 'tool.decided',
            callId: call.callId,
            decision: 'deny',
            by: 'policy',
          });
        } else if (call.status === 'running') {
          events.append(runId, {
            type: 'tool.result',
            callId: call.callId,
            ok: false,
            output: UNFINISHED_CALL,
          });
        }
      }
      events.append(runId, { type: 'run.failed', reason: INTERRUPTED });
      closed += 1;
    }
  }
  return closed;
}
