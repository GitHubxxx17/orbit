import { Check, Copy } from 'lucide-react';
import { isValidElement, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** The text and language of a fenced code block, which react-markdown hands over as a <code> child. */
function codeOf(children: ReactNode): { text: string; language: string | null } {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return { text: '', language: null };
  }
  const raw = children.props.children;
  const text = (typeof raw === 'string' ? raw : '').replace(/\n$/, '');
  const language = /language-([\w-]+)/.exec(children.props.className ?? '')?.[1] ?? null;
  return { text, language };
}

function CodeBlock({ children }: { children: ReactNode }) {
  const { text, language } = codeOf(children);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono">{language ?? 'text'}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? '已复制' : '复制代码'}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {copied ? (
            <Check aria-hidden className="size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed" tabIndex={0}>
        {text}
      </pre>
    </div>
  );
}

// Raw HTML in the text is never rendered (react-markdown escapes it) and dangerous link schemes
// such as javascript: are dropped by its default URL handling; the answer comes from a model and
// may repeat anything it read in a file.
const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="mt-5 mb-2 text-xl font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 font-semibold">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-4" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-sky-600 underline underline-offset-2 dark:text-sky-400"
    >
      {children}
    </a>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border bg-muted/50 px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
};

/** An assistant answer rendered as Markdown. Memoised: only the streaming block changes. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="text-(length:--msg-size) break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
