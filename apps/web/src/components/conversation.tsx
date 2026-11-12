import { memo, useEffect, useRef } from 'react';

import type { Answers } from '@/api';
import { ApprovalPanel } from '@/components/approval-panel';
import { ProcessGroup } from '@/components/process-group';
import { layoutItems } from '@/state/group';
import type { SessionView } from '@/state/session';
import type { RunView } from '@/state/timeline';

const TextBlock = memo(function TextBlock({ text }: { text: string }) {
  return <p className="my-2 leading-relaxed whitespace-pre-wrap">{text}</p>;
});

interface TurnProps {
  view: RunView;
  /** Only the newest turn can be waiting for the user. */
  onApprove: ((approvalId: string, answers: Answers) => Promise<void>) | null;
  index: number;
}

/** One question and the agent's work on it. */
const Turn = memo(function Turn({ view, onApprove, index }: TurnProps) {
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
          {layout.answer && <TextBlock text={layout.answer.text} />}
        </>
      ) : (
        layout.items.map((item) =>
          item.kind === 'text' ? <TextBlock key={item.id} text={item.text} /> : null,
        )
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
  onApprove: (approvalId: string, answers: Answers) => Promise<void>;
}

export function Conversation({ session, onApprove }: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const { turns } = session;
  const last = turns.at(-1);

  // Keep the newest output in view while it streams.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, last?.lastSeq]);

  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        在下方输入一个问题，或直接点“运行”看演示。
        <br />
        可以接着追问，同一个会话里智能体能看到前面的对话。
      </div>
    );
  }

  return (
    <div className="p-4" role="log" aria-live="polite" aria-label="对话">
      {turns.map((view, index) => (
        <Turn
          // Turns are only ever appended, so the position is a stable identity.
          key={index}
          view={view}
          index={index}
          onApprove={index === turns.length - 1 ? onApprove : null}
        />
      ))}
      <div ref={bottom} />
    </div>
  );
}
