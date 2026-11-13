import type { OrbitEvent } from '@orbit/protocol';

import type { SessionView } from '@/state/session';
import { applyEvents, emptyRun, labelOf } from '@/state/timeline';

/**
 * Replay shows a conversation as it was, one step at a time. It is nothing but the same fold the
 * live screen uses, applied to a prefix of the stored events, so what you see in replay is exactly
 * what the log says and cannot drift from the live view.
 */

/** One stop of the replay. */
export interface ReplayStep {
  /** How many events (across all runs, oldest first) have happened once this step is shown. */
  position: number;
  /** What happened at this step, in words. */
  label: string;
  /** 0-based index of the run (turn) the step belongs to. */
  turn: number;
}

/**
 * The stops of a replay. A burst of streamed text is one stop (a step per word would be hundreds
 * of clicks); every other event is a stop of its own.
 */
export function replaySteps(logs: readonly (readonly OrbitEvent[])[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let position = 0;
  logs.forEach((events, turn) => {
    events.forEach((event, index) => {
      position += 1;
      const next = events[index + 1];
      // Inside a burst of text: not a stop, the last delta of the burst is.
      if (event.type === 'message.delta' && next?.type === 'message.delta') return;
      steps.push({ position, label: labelOf(event), turn });
    });
  });
  return steps;
}

/** The conversation after the first `position` events. Runs that have not begun are not shown. */
export function replayAt(logs: readonly (readonly OrbitEvent[])[], position: number): SessionView {
  let left = Math.max(0, position);
  const turns = [];
  for (const events of logs) {
    if (left <= 0) break;
    turns.push(applyEvents(emptyRun, events.slice(0, left)));
    left -= events.length;
  }
  return { turns };
}
