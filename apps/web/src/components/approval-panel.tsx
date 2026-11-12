import { ShieldQuestion } from 'lucide-react';
import { useId, useState } from 'react';

import type { Answers } from '@/api';
import { DiffView } from '@/components/diff-view';
import { Button } from '@/components/ui/button';
import { describeTool } from '@/state/describe';
import type { ToolCard } from '@/state/timeline';

interface Props {
  approvalId: string;
  cards: ToolCard[];
  onSubmit: (approvalId: string, answers: Answers) => Promise<void>;
}

/**
 * Everything the agent wants to change this turn, reviewed together. Each change starts selected;
 * the user unticks what they do not want, then applies the rest or rejects everything.
 */
export function ApprovalPanel({ approvalId, cards, onSubmit }: Props) {
  const headingId = useId();
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(cards.map((card) => [card.callId, true])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = cards.filter((card) => selected[card.callId]).length;

  const send = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const answers: Answers = Object.fromEntries(
        cards.map((card) => [card.callId, apply && selected[card.callId] ? 'allow' : 'deny']),
      );
      await onSubmit(approvalId, answers);
      // On success the run continues and the cards stop waiting, which removes this panel.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="my-3 rounded-xl border border-orange-400/40 bg-orange-400/5 p-3"
    >
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-medium">
        <ShieldQuestion aria-hidden className="size-4 text-orange-400" />
        需要你确认 {cards.length} 项修改，批准前不会写入任何文件
      </h2>

      <ul className="mt-3 space-y-3">
        {cards.map((card) => {
          const label = describeTool(card.tool, card.args);
          const checkId = `${approvalId}-${card.callId}`;
          return (
            <li key={card.callId}>
              <label htmlFor={checkId} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  id={checkId}
                  type="checkbox"
                  className="size-4 accent-orange-400"
                  checked={selected[card.callId] ?? false}
                  disabled={busy}
                  onChange={(event) =>
                    setSelected((current) => ({ ...current, [card.callId]: event.target.checked }))
                  }
                />
                <span>{label}</span>
              </label>
              <div className="mt-1.5 ml-6">
                <DiffView diff={card.preview ?? ''} label={`${label} 的修改内容`} />
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          提交失败：{error}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void send(false)}>
          全部拒绝
        </Button>
        <Button disabled={busy || count === 0} onClick={() => void send(true)}>
          应用所选（{count}）
        </Button>
      </div>
    </section>
  );
}
