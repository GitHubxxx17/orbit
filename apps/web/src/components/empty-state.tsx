const SUGGESTIONS = [
  '这个工作区里有什么？',
  '读一下 package.json，说说这个项目是做什么的',
  '在 notes/todo.md 里写一份今天的待办',
];

interface Props {
  workspaceName: string;
  onPick: (text: string) => void;
}

/** Shown before the first message: a greeting and a few things to try. */
export function EmptyState({ workspaceName, onPick }: Props) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">
        你想让星轨在{' '}
        <span className="underline decoration-dotted underline-offset-4">{workspaceName}</span>{' '}
        中做什么？
      </h1>
      <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="示例问题">
        {SUGGESTIONS.map((text) => (
          <li key={text}>
            <button
              type="button"
              onClick={() => onPick(text)}
              className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
