import { memo, useEffect, useRef } from 'react';

import { ProcessGroup } from '@/components/process-group';
import { layoutItems } from '@/state/group';
import type { RunView } from '@/state/timeline';

const TextBlock = memo(function TextBlock({ text }: { text: string }) {
  return <p className="my-2 leading-relaxed whitespace-pre-wrap">{text}</p>;
});

export function Conversation({ prompt, view }: { prompt: string | null; view: RunView }) {
  const bottom = useRef<HTMLDivElement>(null);
  const layout = layoutItems(view.items, view.status);

  // Keep the newest output in view while it streams.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [view.lastSeq]);

  if (prompt === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        在下方输入一个问题，或直接点“运行”看演示。
        <br />
        每一步都会记录成事件，显示在右侧时间线。
      </div>
    );
  }

  return (
    <div className="p-4" role="log" aria-live="polite" aria-label="对话">
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
        {prompt}
      </div>

      {layout.grouped ? (
        <>
          {/* Keyed by run so a new run starts open instead of inheriting the last run's choice. */}
          <ProcessGroup
            key={view.runId}
            steps={layout.steps}
            tools={view.tools}
            status={view.status}
          />
          {layout.answer && <TextBlock text={layout.answer.text} />}
        </>
      ) : (
        layout.items.map((item) =>
          item.kind === 'text' ? <TextBlock key={item.id} text={item.text} /> : null,
        )
      )}

      {view.status === 'failed' && (
        <p role="alert" className="my-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          运行失败：{view.failReason}
        </p>
      )}
      <div ref={bottom} />
    </div>
  );
}
