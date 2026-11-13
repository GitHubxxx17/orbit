import type { RunView } from '@/state/timeline';

export type ChangeStatus =
  'awaiting' | 'applying' | 'applied' | 'rolledback' | 'rejected' | 'failed';

/** One file change the agent proposed, from any turn of the conversation. */
export interface Change {
  /** Unique within the conversation. */
  key: string;
  /** 1-based turn number. */
  turn: number;
  path: string;
  status: ChangeStatus;
  diff: string;
  runId: string | null;
  callId: string;
  /** The write really happened and has not been undone, so it can be rolled back. */
  canRollback: boolean;
}

const STATUS = {
  awaiting: 'awaiting',
  running: 'applying',
  done: 'applied',
  denied: 'rejected',
  failed: 'failed',
} as const;

/** Every write the agent proposed, oldest first, with what became of it. */
export function collectChanges(turns: readonly RunView[]): Change[] {
  return turns.flatMap((view, index) =>
    Object.values(view.tools)
      .filter((card) => card.tool === 'write_file' && card.preview !== undefined)
      .flatMap((card) => {
        const base = STATUS[card.status as keyof typeof STATUS];
        if (!base) return [];
        const rolledBack = card.rolledBack === true;
        const path = typeof card.args['path'] === 'string' ? card.args['path'] : '(未知路径)';
        return [
          {
            key: `${index}:${card.callId}`,
            turn: index + 1,
            path,
            status: rolledBack ? ('rolledback' as const) : base,
            diff: card.preview ?? '',
            runId: view.runId,
            callId: card.callId,
            canRollback: card.changed === true && !rolledBack && view.runId !== null,
          },
        ];
      }),
  );
}
