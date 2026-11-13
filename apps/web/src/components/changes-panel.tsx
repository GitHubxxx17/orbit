import { Undo2 } from 'lucide-react';
import { useState } from 'react';

import { DiffView } from '@/components/diff-view';
import { Button } from '@/components/ui/button';
import type { Change, ChangeStatus } from '@/state/changes';

const STATUS: Record<ChangeStatus, { label: string; className: string }> = {
  awaiting: { label: '等待审批', className: 'text-orange-600 dark:text-orange-400' },
  applying: { label: '应用中', className: 'text-sky-600 dark:text-sky-400' },
  applied: { label: '已应用', className: 'text-emerald-600 dark:text-emerald-400' },
  rolledback: { label: '已撤销', className: 'text-muted-foreground' },
  rejected: { label: '已拒绝', className: 'text-red-600 dark:text-red-400' },
  failed: { label: '应用失败', className: 'text-amber-600 dark:text-amber-400' },
};

interface Props {
  changes: Change[];
  /** Undo one change on disk. Rejects with the reason it could not (for example a conflict). */
  onRollback: ((change: Change) => Promise<void>) | null;
}

/** Undoing needs a second click: it writes to the user's files. */
function RollbackButton({
  change,
  onRollback,
}: {
  change: Change;
  onRollback: (change: Change) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRollback(change);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs text-muted-foreground">
            文件会恢复成修改前的样子（新建的文件会被删除）。
          </span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void undo()}>
            确认撤销
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
            取消
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          <Undo2 aria-hidden className="size-3.5" />
          撤销这次修改
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          撤销失败：{error}
        </p>
      )}
    </div>
  );
}

/** Every file change proposed in this conversation, with what became of it. */
export function ChangesPanel({ changes, onRollback }: Props) {
  if (changes.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">这个会话里还没有文件修改。</p>;
  }
  return (
    <ul className="space-y-1 p-3" aria-label="文件修改">
      {changes.map((change) => {
        const { label, className } = STATUS[change.status];
        return (
          <li key={change.key}>
            <details className="group rounded-lg border bg-card/50">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <span className="truncate font-mono text-xs" title={change.path}>
                  {change.path}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  第 {change.turn} 轮
                </span>
                <span className={`shrink-0 text-xs ${className}`}>{label}</span>
              </summary>
              <div className="px-3 pb-3">
                <DiffView diff={change.diff} label={`${change.path} 的修改内容`} />
                {change.canRollback && onRollback && (
                  <RollbackButton change={change} onRollback={onRollback} />
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
