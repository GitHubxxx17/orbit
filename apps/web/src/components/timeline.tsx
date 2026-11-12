import { memo } from 'react';

import type { TimelineRow } from '@/state/timeline';

const DOT: Record<TimelineRow['type'], string> = {
  'run.started': 'bg-sky-400',
  'user.message': 'bg-sky-300',
  'message.delta': 'bg-zinc-500',
  'tool.requested': 'bg-violet-400',
  'tool.decided': 'bg-amber-400',
  'approval.requested': 'bg-orange-400',
  'tool.result': 'bg-emerald-400',
  'run.completed': 'bg-emerald-400',
  'run.failed': 'bg-red-400',
};

const Row = memo(function Row({ row }: { row: TimelineRow }) {
  return (
    <li className="flex items-center gap-3 py-1.5 text-sm">
      <span className="w-7 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {row.seq}
      </span>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[row.type]}`} />
      <span className="truncate">{row.label}</span>
      {row.count > 1 && <span className="text-xs text-muted-foreground">×{row.count}</span>}
      <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{row.type}</span>
    </li>
  );
});

export function Timeline({ rows }: { rows: TimelineRow[] }) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">还没有事件。</p>;
  }
  return (
    <ol className="divide-y divide-border/50 px-4 py-2" aria-label="事件时间线">
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </ol>
  );
}
