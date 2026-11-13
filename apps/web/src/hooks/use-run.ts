import { OrbitEvent } from '@orbit/protocol';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
  cancelRun,
  fetchRunEvents,
  fetchSessionRuns,
  startRun,
  streamUrl,
  submitApproval,
  type Answers,
  type ApprovalMode,
  type RunMode,
} from '@/api';
import { emptySession, sessionReducer } from '@/state/session';
import { applyEvents, emptyRun } from '@/state/timeline';

export type Connection = 'closed' | 'open' | 'reconnecting';

/**
 * Starts runs and follows their event stream. Incoming events are collected and applied once per
 * animation frame, so a burst of text deltas costs one render instead of one per delta.
 */
export function useRun() {
  const [session, dispatch] = useReducer(sessionReducer, emptySession);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const view = session.turns.at(-1) ?? emptyRun;
  const [connection, setConnection] = useState<Connection>('closed');
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);
  const buffer = useRef<OrbitEvent[]>([]);
  const frame = useRef<number | null>(null);

  const close = useCallback(() => {
    source.current?.close();
    source.current = null;
    setConnection('closed');
  }, []);

  const flush = useCallback(() => {
    frame.current = null;
    const events = buffer.current;
    buffer.current = [];
    if (events.length > 0) dispatch({ type: 'events', events });
  }, []);

  /** Follow a run's stream, starting after event `after` (0 = from the beginning). */
  const follow = useCallback(
    (runId: string, after = 0) => {
      const es = new EventSource(streamUrl(runId, after));
      source.current = es;
      es.onopen = () => setConnection('open');
      // EventSource reconnects by itself and resumes from Last-Event-ID.
      es.onerror = () =>
        setConnection(es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
      es.addEventListener('orbit', (message) => {
        // The stream is external input: validate before it reaches the UI state.
        let parsed;
        try {
          parsed = OrbitEvent.safeParse(JSON.parse((message as MessageEvent<string>).data));
        } catch {
          return;
        }
        if (!parsed.success) return;
        buffer.current.push(parsed.data);
        frame.current ??= requestAnimationFrame(flush);
        if (parsed.data.type === 'run.completed' || parsed.data.type === 'run.failed') {
          // The server ends the stream after a terminal event; close so it is not reopened.
          close();
        }
      });
    },
    [close, flush],
  );

  const start = useCallback(
    async (
      prompt: string,
      mode: RunMode,
      approval: ApprovalMode,
      modelId?: string,
    ): Promise<boolean> => {
      close();
      buffer.current = [];
      setError(null);
      dispatch({ type: 'new-turn', prompt });
      try {
        const started = await startRun(prompt, mode, approval, sessionId ?? undefined, modelId);
        setSessionId(started.sessionId);
        follow(started.runId);
        return true;
      } catch (e) {
        dispatch({ type: 'drop-turn' });
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [close, follow, sessionId],
  );

  /** Open an earlier conversation: rebuild every turn from the stored events of its runs. */
  const openSession = useCallback(
    async (id: string) => {
      close();
      buffer.current = [];
      setError(null);
      try {
        const runIds = await fetchSessionRuns(id);
        const logs = await Promise.all(runIds.map((runId) => fetchRunEvents(runId)));
        const turns = logs.map((events) => applyEvents(emptyRun, events));
        dispatch({ type: 'load', turns });
        setSessionId(id);
        // A run that is still going keeps streaming from where the stored events stop.
        const last = turns.at(-1);
        if (last?.status === 'running' && last.runId) follow(last.runId, last.lastSeq);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [close, follow],
  );

  /** Forget the conversation; the next message starts a new one. */
  const newSession = useCallback(() => {
    // Do not leave a run going in a conversation nobody is looking at any more.
    if (view.status === 'running' && view.runId) void cancelRun(view.runId).catch(() => undefined);
    close();
    buffer.current = [];
    setSessionId(null);
    setError(null);
    dispatch({ type: 'new-session' });
  }, [close, view.status, view.runId]);

  const cancel = useCallback(async () => {
    if (!view.runId) return;
    try {
      await cancelRun(view.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [view.runId]);

  /** Send the user's answer. Throws on failure so the approval panel can show the reason. */
  const approve = useCallback(
    async (approvalId: string, answers: Answers) => {
      if (!view.runId) throw new Error('没有正在运行的任务');
      await submitApproval(view.runId, approvalId, answers);
    },
    [view.runId],
  );

  useEffect(
    () => () => {
      source.current?.close();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return {
    session,
    sessionId,
    view,
    connection,
    error,
    start,
    cancel,
    approve,
    newSession,
    openSession,
  };
}
