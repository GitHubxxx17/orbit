import { memo } from 'react';

import { usePreferences } from '@/hooks/use-preferences';

/** Style a unified-diff line by its first characters. */
function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground';
  if (line.startsWith('+')) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (line.startsWith('-')) return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (line.startsWith('@@')) return 'text-sky-600 dark:text-sky-400';
  return 'text-muted-foreground';
}

function DiffViewImpl({ diff, label }: { diff: string; label: string }) {
  const { plainDiff } = usePreferences();
  // The separator line of "====" that diff libraries print adds nothing.
  const lines = diff.split('\n').filter((line) => !/^=+$/.test(line));

  return (
    <pre
      className="max-h-72 overflow-auto rounded-md bg-muted/50 py-1 font-mono text-xs"
      tabIndex={0}
      aria-label={label}
    >
      {lines.map((line, index) => (
        <div key={index} className={`px-2 whitespace-pre ${plainDiff ? '' : lineClass(line)}`}>
          {line === '' ? ' ' : line}
        </div>
      ))}
    </pre>
  );
}

export const DiffView = memo(DiffViewImpl);
