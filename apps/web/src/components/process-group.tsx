import { ChevronRight } from 'lucide-react';
import { memo, useId, useState } from 'react';

import { ToolStep } from '@/components/tool-step';
import { summarizeSteps, summaryText } from '@/state/group';
import type { ChatItem, RunStatus, ToolCard } from '@/state/timeline';

const Narration = memo(function Narration({ text }: { text: string }) {
  return <p className="py-1 text-sm whitespace-pre-wrap text-muted-foreground">{text}</p>;
});

interface Props {
  steps: ChatItem[];
  tools: Record<string, ToolCard>;
  status: RunStatus;
}

/** The collapsible "what the agent did" section. Open while running, collapsed once it ends. */
export function ProcessGroup({ steps, tools, status }: Props) {
  const panelId = useId();
  // null means "follow the run": open while running, closed afterwards. A click overrides it.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? status === 'running';

  return (
    <section className="my-3 rounded-xl border bg-card/40" aria-label="处理过程">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setChosen(!open)}
      >
        <ChevronRight
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">{summaryText(summarizeSteps(steps, tools), status)}</span>
      </button>

      {open && (
        <ul id={panelId} className="border-t px-3 py-1">
          {steps.map((item) => {
            if (item.kind === 'text') {
              return (
                <li key={item.id}>
                  <Narration text={item.text} />
                </li>
              );
            }
            const card = tools[item.callId];
            return card ? <ToolStep key={item.id} card={card} /> : null;
          })}
        </ul>
      )}
    </section>
  );
}
