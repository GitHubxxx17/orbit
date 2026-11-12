import { OrbitEvent } from '@orbit/protocol';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { cancelRun, startRun, streamUrl, type RunMode } from '@/api';
import { applyEvents, emptyRun, type RunView } from '@/state/timeline';

type Action = { type: 'reset' } | { type: 'events'; events: OrbitEvent[] };

function reducer(view: RunView, action: Action): RunView {
  return action.type === 'reset' ? emptyRun : applyEvents(view, action.events);
}

export type Connection = 'closed' | 'open' | 'reconnecting';

/**
 * Starts runs and follows their event stream. Incoming events are collected and applied once per
 * animation frame, so a burst of text deltas costs one render instead of one per delta.
 */
export function useRun() {
  const [view, dispatch] = useReducer(reducer, emptyRun);
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

  const follow = useCallback(
    (runId: string) => {
      const es = new EventSource(streamUrl(runId));
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
    async (prompt: string, mode: RunMode) => {
      close();
      buffer.current = [];
      dispatch({ type: 'reset' });
      setError(null);
      try {
        follow(await startRun(prompt, mode));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [close, follow],
  );

  const cancel = useCallback(async () => {
    if (!view.runId) return;
    try {
      await cancelRun(view.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [view.runId]);

  useEffect(
    () => () => {
      source.current?.close();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { view, connection, error, start, cancel };
}
