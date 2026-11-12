import type { OrbitEvent } from '@orbit/protocol';

import { applyEvents, emptyRun, type RunView } from '@/state/timeline';

/** A conversation: one view per question the user asked, oldest first. */
export interface SessionView {
  turns: RunView[];
}

export const emptySession: SessionView = { turns: [] };

export type SessionAction =
  | { type: 'new-session' }
  /** The user sent a message; show it at once, before the server's first event arrives. */
  | { type: 'new-turn'; prompt: string }
  /** The message could not be sent, so take the placeholder back out. */
  | { type: 'drop-turn' }
  | { type: 'events'; events: OrbitEvent[] };

export function sessionReducer(session: SessionView, action: SessionAction): SessionView {
  switch (action.type) {
    case 'new-session':
      return emptySession;
    case 'new-turn':
      return { turns: [...session.turns, { ...emptyRun, prompt: action.prompt }] };
    case 'drop-turn':
      return { turns: session.turns.slice(0, -1) };
    case 'events': {
      // Events always belong to the newest run; earlier turns are finished and stay as they are.
      const last = session.turns.at(-1);
      if (!last) return session;
      return { turns: [...session.turns.slice(0, -1), applyEvents(last, action.events)] };
    }
  }
}
