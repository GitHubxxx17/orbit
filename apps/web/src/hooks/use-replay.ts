import type { OrbitEvent } from '@orbit/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchRunEvents, fetchSessionRuns } from '@/api';
import { replayAt, replaySteps, type ReplayStep } from '@/state/replay';
import type { SessionView } from '@/state/session';

const STEP_MS = 700;

/**
 * Replays a stored conversation. It reads the events once when replay starts and then only moves a
 * cursor over them; nothing here talks to the running agent, so replay can never change anything.
 */
export function useReplay() {
  const [logs, setLogs] = useState<OrbitEvent[][] | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps: ReplayStep[] = useMemo(() => replaySteps(logs ?? []), [logs]);
  const active = logs !== null;

  const view: SessionView = useMemo(
    () => replayAt(logs ?? [], step === 0 ? 0 : (steps[step - 1]?.position ?? 0)),
    [logs, steps, step],
  );

  const enter = useCallback(async (sessionId: string) => {
    setError(null);
    try {
      const runIds = await fetchSessionRuns(sessionId);
      const loaded = await Promise.all(runIds.map((runId) => fetchRunEvents(runId)));
      setLogs(loaded);
      setStep(0);
      setPlaying(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const exit = useCallback(() => {
    setLogs(null);
    setStep(0);
    setPlaying(false);
  }, []);

  const goTo = useCallback(
    (to: number) => {
      // Moving by hand pauses autoplay.
      setPlaying(false);
      setStep(Math.min(Math.max(0, Math.round(to)), steps.length));
    },
    [steps.length],
  );

  // Autoplay advances one stop at a time and ends by itself at the last one.
  const autoplaying = playing && step < steps.length;
  useEffect(() => {
    if (!autoplaying) return;
    const timer = setTimeout(() => setStep((current) => current + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [autoplaying, step]);

  const toggle = useCallback(() => {
    if (autoplaying) {
      setPlaying(false);
      return;
    }
    // Pressing play at the end starts over.
    if (step >= steps.length) setStep(0);
    setPlaying(true);
  }, [autoplaying, step, steps.length]);

  return {
    active,
    error,
    view,
    steps,
    step,
    total: steps.length,
    current: step === 0 ? null : (steps[step - 1] ?? null),
    playing: autoplaying,
    enter,
    exit,
    goTo,
    toggle,
  };
}
