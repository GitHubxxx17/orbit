import { useState } from 'react';

import { ChangesPanel } from '@/components/changes-panel';
import { Timeline } from '@/components/timeline';
import type { Change } from '@/state/changes';
import type { TimelineRow } from '@/state/timeline';

type Tab = 'timeline' | 'changes';

interface Props {
  rows: TimelineRow[];
  lastSeq: number;
  changes: Change[];
  /** Undo a change; null while replaying, when nothing may be changed. */
  onRollback: ((change: Change) => Promise<void>) | null;
}

/** The side panel: the event timeline of the latest run, and the conversation's file changes. */
export function RightPanel({ rows, lastSeq, changes, onRollback }: Props) {
  const [tab, setTab] = useState<Tab>('timeline');
  const awaiting = changes.filter((c) => c.status === 'awaiting').length;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'timeline', label: '时间线' },
    { id: 'changes', label: '变更', badge: changes.length },
  ];

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l bg-background">
      <div role="tablist" aria-label="侧栏" className="flex gap-1 border-b px-3 py-2">
        {tabs.map(({ id, label, badge }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              tab === id ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {badge ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {awaiting > 0 && id === 'changes' ? `${awaiting}/${badge}` : badge}
              </span>
            ) : null}
          </button>
        ))}
        {tab === 'timeline' && (
          <span className="ml-auto self-center font-mono text-xs text-muted-foreground">
            {lastSeq}
          </span>
        )}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === 'timeline' ? (
          <Timeline rows={rows} />
        ) : (
          <ChangesPanel changes={changes} onRollback={onRollback} />
        )}
      </div>
    </aside>
  );
}
