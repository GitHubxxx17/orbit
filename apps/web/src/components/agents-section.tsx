import { useEffect, useState, type FormEvent } from 'react';

import { fetchTools, removeAgent, saveAgent, type AgentList, type AgentProfile } from '@/api';
import { MenuSelect } from '@/components/menu-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAgents } from '@/hooks/use-agents';
import { useModels } from '@/hooks/use-models';
import {
  agentFormInput,
  agentFormProblem,
  EMPTY_AGENT,
  type AgentFormValues,
} from '@/lib/agent-form';

const field =
  'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';

const RISK_LABEL = { read: '只读', write: '会写入', dangerous: '危险' } as const;

type Editing = string | 'new' | null;
type Notice = { kind: 'ok' | 'error'; text: string } | null;

interface Props {
  /** The agent list changed; the app should read it again. */
  onChanged: () => void;
}

/** Agent profiles: a name, a model, extra instructions and the tools an agent may call. */
export function AgentsSection({ onChanged }: Props) {
  const { list, failed, adopt } = useAgents();
  const { list: models } = useModels();
  const [tools, setTools] = useState<{ name: string; risk: keyof typeof RISK_LABEL }[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [values, setValues] = useState<AgentFormValues>(EMPTY_AGENT);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // `report` is always available to every agent, so it is not offered as a choice.
  useEffect(() => {
    fetchTools().then(
      (result) => setTools(result.tools.filter((tool) => tool.name !== 'report')),
      () => setTools([]),
    );
  }, []);

  const set = <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const open = (target: AgentProfile | 'new') => {
    setNotice(null);
    setConfirmDelete(null);
    if (target === 'new') {
      setEditing('new');
      setValues(EMPTY_AGENT);
    } else {
      setEditing(target.id);
      setValues({
        name: target.name,
        description: target.description,
        instructions: target.instructions,
        modelId: target.modelId,
        tools: target.tools,
      });
    }
  };

  const problem = agentFormProblem(values);

  const change = async (request: () => Promise<AgentList>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      adopt(await request());
      onChanged();
      setNotice({ kind: 'ok', text: done });
      return true;
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem || busy || editing === null) return;
    const id = editing === 'new' ? null : editing;
    const ok = await change(
      () => saveAgent(id, agentFormInput(values)),
      id === null ? '已添加，可以在输入框里选用它' : '已保存，新的运行立即生效',
    );
    if (ok) setEditing(null);
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    const ok = await change(() => removeAgent(id), '已删除');
    if (ok && editing === id) setEditing(null);
  };

  const modelOptions = [
    { value: '', label: '跟随输入框的选择' },
    ...models.models.map((model) => ({ value: model.id, label: model.label })),
  ];

  const toggleTool = (name: string, on: boolean) => {
    const current = values.tools ?? [];
    set('tools', on ? [...current, name] : current.filter((n) => n !== name));
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-8" aria-label="智能体设置">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">智能体</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              一份配置一个智能体：选模型、补充说明、限定能用的工具。它只会收窄能力，审批和沙箱规则对所有智能体一样。
            </p>
          </div>
          <Button type="button" disabled={busy} onClick={() => open('new')}>
            添加智能体
          </Button>
        </header>

        {failed && (
          <p role="alert" className="text-sm text-destructive">
            读取智能体失败，请确认服务端在运行。
          </p>
        )}

        <ul className="space-y-2" aria-label="智能体列表">
          {list.agents.map((agent) => (
            <li key={agent.id} className="rounded-xl border bg-card/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium">{agent.name}</span>
                {agent.builtin && <Badge variant="outline">内置</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {agent.description || '没有说明'} ·{' '}
                {agent.tools === null ? '全部工具' : `${agent.tools.length} 个工具`}
                {agent.modelId
                  ? ` · 模型：${models.models.find((m) => m.id === agent.modelId)?.label ?? '已删除，将用默认模型'}`
                  : ''}
              </p>
              {!agent.builtin && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => open(agent)}
                  >
                    编辑
                  </Button>
                  {confirmDelete === agent.id ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void remove(agent.id)}
                      >
                        确认删除
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(null)}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmDelete(agent.id)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {notice && editing === null && (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`text-sm ${
              notice.kind === 'error'
                ? 'text-destructive'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {notice.text}
          </p>
        )}

        {editing !== null && (
          <form
            onSubmit={(event) => void submit(event)}
            className="space-y-4 rounded-xl border p-4"
            aria-label={editing === 'new' ? '添加智能体' : '编辑智能体'}
          >
            <h2 className="text-sm font-semibold">
              {editing === 'new' ? '添加智能体' : '编辑智能体'}
            </h2>

            <div className="space-y-1.5">
              <label htmlFor="agent-name" className="text-sm font-medium">
                名称
              </label>
              <input
                id="agent-name"
                className={`${field} h-9 py-0`}
                value={values.name}
                maxLength={40}
                onChange={(e) => set('name', e.target.value)}
                placeholder="例如：代码审查员"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="agent-description" className="text-sm font-medium">
                说明
              </label>
              <input
                id="agent-description"
                className={`${field} h-9 py-0`}
                value={values.description}
                maxLength={200}
                onChange={(e) => set('description', e.target.value)}
                placeholder="可选，一句话说明它做什么"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="agent-instructions" className="text-sm font-medium">
                补充说明
              </label>
              <textarea
                id="agent-instructions"
                className={`${field} min-h-28 resize-y`}
                value={values.instructions}
                maxLength={4000}
                onChange={(e) => set('instructions', e.target.value)}
                placeholder="可选。会接在内置系统提示词后面，内置的安全和汇报规则仍然有效。"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">模型</p>
              <MenuSelect<string>
                label="模型"
                value={values.modelId ?? ''}
                options={modelOptions}
                onChange={(id) => set('modelId', id === '' ? null : id)}
                className="max-w-60"
              />
              <p className="text-xs text-muted-foreground">输入框里手动选的模型优先于这里。</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">可用工具</legend>
              <div
                role="group"
                aria-label="工具范围"
                className="flex w-fit rounded-md bg-muted p-0.5"
              >
                {[
                  { custom: false, label: '全部工具' },
                  { custom: true, label: '自选' },
                ].map(({ custom, label }) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={(values.tools !== null) === custom}
                    onClick={() => set('tools', custom ? (values.tools ?? []) : null)}
                    className={`rounded px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      (values.tools !== null) === custom
                        ? 'bg-background font-medium shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {values.tools !== null && (
                <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {tools.map((tool) => (
                    <li key={tool.name}>
                      <label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/50">
                        <input
                          type="checkbox"
                          checked={values.tools?.includes(tool.name) ?? false}
                          onChange={(e) => toggleTool(tool.name, e.target.checked)}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {tool.name}
                        </span>
                        <span
                          className={`shrink-0 text-xs ${
                            tool.risk === 'read'
                              ? 'text-muted-foreground'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {RISK_LABEL[tool.risk]}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                汇报工具（report）总是可用。限定工具只会减少能力，写入仍然要经过审批。
              </p>
            </fieldset>

            {notice && (
              <p
                role={notice.kind === 'error' ? 'alert' : 'status'}
                className={`text-sm ${
                  notice.kind === 'error'
                    ? 'text-destructive'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {notice.text}
              </p>
            )}
            {problem && <p className="text-xs text-muted-foreground">{problem}</p>}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={problem !== null || busy}>
                {busy ? '保存中…' : '保存'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                取消
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
