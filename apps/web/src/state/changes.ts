import type { RunView } from '@/state/timeline';

export type ChangeStatus = 'awaiting' | 'applying' | 'applied' | 'rejected' | 'failed';

/** One file change the agent proposed, from any turn of the conversation. */
export interface Change {
  /** Unique within the conversation. */
  key: string;
  /** 1-based turn number. */
  turn: number;
  path: string;
  status: ChangeStatus;
  diff: string;
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
        const status = STATUS[card.status as keyof typeof STATUS];
        if (!status) return [];
        const path = typeof card.args['path'] === 'string' ? card.args['path'] : '(未知路径)';
        return [
          {
            key: `${index}:${card.callId}`,
            turn: index + 1,
            path,
            status,
            diff: card.preview ?? '',
          },
        ];
      }),
  );
}
