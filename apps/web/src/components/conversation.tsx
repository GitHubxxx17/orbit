import { memo, useEffect, useRef } from 'react';

import type { Answers } from '@/api';
import { ApprovalPanel } from '@/components/approval-panel';
import { Markdown } from '@/components/markdown';
import { ProcessGroup } from '@/components/process-group';
import { duration } from '@/lib/format';
import { layoutItems } from '@/state/group';
import type { SessionView } from '@/state/session';
import type { RunView } from '@/state/timeline';

interface TurnProps {
  view: RunView;
  /** The live model's name, for the line under an answer. */
  liveModel: string | null;
  /** Only the newest turn can be waiting for the user. */
  onApprove: ((approvalId: string, answers: Answers) => Promise<void>) | null;
  index: number;
}

function modelLabel(view: RunView, liveModel: string | null): string {
  return view.agentId === 'orbit-demo' ? '演示模型' : (liveModel ?? '真实模型');
}

/** One question and the agent's work on it. */
const Turn = memo(function Turn({ view, liveModel, onApprove, index }: TurnProps) {
  const layout = layoutItems(view.items, view.status);
  const waiting = Object.values(view.tools).filter((card) => card.status === 'awaiting');
  const approvalId = waiting[0]?.approvalId;

  return (
    <section aria-label={`第 ${index + 1} 轮`} className="mb-6">
      {view.prompt !== null && (
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary px-4 py-2 whitespace-pre-wrap text-primary-foreground">
          {view.prompt}
        </div>
      )}

      {layout.grouped ? (
        <>
          <ProcessGroup steps={layout.steps} tools={view.tools} status={view.status} />
          {layout.answer && <Markdown text={layout.answer.text} />}
        </>
      ) : (
        layout.items.map((item) =>
          item.kind === 'text' ? <Markdown key={item.id} text={item.text} /> : null,
        )
      )}

      {view.status === 'completed' && view.startedAt !== null && view.endedAt !== null && (
        <p className="mt-1 mb-2 text-xs text-muted-foreground">
          {modelLabel(view, liveModel)} · 用时 {duration(view.endedAt - view.startedAt)}
        </p>
      )}

      {approvalId && onApprove && (
        // Keyed by approval so a new request starts with every change selected again.
        <ApprovalPanel
          key={approvalId}
          approvalId={approvalId}
          cards={waiting.filter((card) => card.approvalId === approvalId)}
          onSubmit={onApprove}
        />
      )}

      {view.status === 'failed' && (
        <p role="alert" className="my-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          运行失败：{view.failReason}
        </p>
      )}
    </section>
  );
});

interface Props {
  session: SessionView;
  liveModel: string | null;
  onApprove: (approvalId: string, answers: Answers) => Promise<void>;
}

export function Conversation({ session, liveModel, onApprove }: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const { turns } = session;
  const last = turns.at(-1);

  // Keep the newest output in view while it streams.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, last?.lastSeq]);

  return (
    <div className="mx-auto w-full max-w-3xl p-4" role="log" aria-live="polite" aria-label="对话">
      {turns.map((view, index) => (
        <Turn
          // Turns are only ever appended, so the position is a stable identity.
          key={index}
          view={view}
          liveModel={liveModel}
          index={index}
          onApprove={index === turns.length - 1 ? onApprove : null}
        />
      ))}
      <div ref={bottom} />
    </div>
  );
}
