import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { clearModel, fetchModel, saveModel, testModel, type ModelStatus } from '@/api';
import { Button } from '@/components/ui/button';
import { McpSection } from '@/components/mcp-section';
import {
  BASE_URL_PRESETS,
  modelFormInput,
  modelFormProblem,
  type ModelFormValues,
} from '@/lib/model-form';

interface Props {
  onBack: () => void;
  /** The saved model changed; the app should read the server info again. */
  onChanged: () => void;
}

const SOURCE_LABEL = {
  settings: '来自设置页',
  env: '来自 .env 环境变量',
  none: '尚未配置',
} as const;

const field =
  'h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function SettingsView({ onBack, onChanged }: Props) {
  const [section, setSection] = useState<'model' | 'mcp'>('model');
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [values, setValues] = useState<ModelFormValues>({ baseUrl: '', model: '', apiKey: '' });
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // Fill the form with what is in use. The key is never sent back, so its field stays empty.
  const adopt = (next: ModelStatus) => {
    setStatus(next);
    setValues({ baseUrl: next.baseUrl ?? '', model: next.model ?? '', apiKey: '' });
  };

  useEffect(() => {
    fetchModel().then(adopt, () => setLoadFailed(true));
  }, []);

  const set = (key: keyof ModelFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const problem = modelFormProblem(values, status?.configured ?? false);

  const run = async (kind: 'save' | 'test' | 'clear') => {
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === 'test') {
        const result = await testModel(modelFormInput(values));
        setNotice({
          kind: result.ok ? 'ok' : 'error',
          text: result.ok
            ? `连接成功（${result.latencyMs ?? '?'} ms）`
            : `连接失败：${result.message}`,
        });
      } else {
        const next = kind === 'save' ? await saveModel(modelFormInput(values)) : await clearModel();
        adopt(next);
        onChanged();
        setNotice({ kind: 'ok', text: kind === 'save' ? '已保存，新的会话立即生效' : '已清除' });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!problem && busy === null) void run('save');
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <nav aria-label="设置" className="flex w-60 shrink-0 flex-col border-r bg-sidebar p-3">
        <Button variant="ghost" className="mb-3 w-full justify-start" onClick={onBack}>
          <ArrowLeft aria-hidden data-icon="inline-start" />
          返回
        </Button>
        {(['model', 'mcp'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
            className={`rounded-lg px-2.5 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              section === id
                ? 'bg-muted font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {id === 'model' ? '模型' : 'MCP'}
          </button>
        ))}
      </nav>

      {section === 'mcp' ? (
        <McpSection />
      ) : (
        <main className="min-w-0 flex-1 overflow-y-auto p-8" aria-label="模型设置">
          <form onSubmit={submit} className="mx-auto max-w-xl space-y-5">
            <header>
              <h1 className="text-lg font-semibold">模型</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                任何兼容 OpenAI 接口的服务都可以。保存后无需重启，新开始的运行就会使用它。
              </p>
            </header>

            {loadFailed && (
              <p role="alert" className="text-sm text-destructive">
                读取当前设置失败，请确认服务端在运行。
              </p>
            )}

            {status && (
              <p className="text-sm text-muted-foreground">
                当前：{SOURCE_LABEL[status.source]}
                {status.configured && status.apiKeyHint
                  ? `，API Key 以 …${status.apiKeyHint} 结尾`
                  : ''}
              </p>
            )}

            <div className="space-y-1.5">
              <label htmlFor="base-url" className="text-sm font-medium">
                接口地址
              </label>
              <input
                id="base-url"
                className={field}
                value={values.baseUrl}
                onChange={(e) => set('baseUrl')(e.target.value)}
                placeholder="https://api.example.com/v1"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex flex-wrap gap-2">
                {BASE_URL_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => set('baseUrl')(preset.baseUrl)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="model-name" className="text-sm font-medium">
                模型名称
              </label>
              <input
                id="model-name"
                className={field}
                value={values.model}
                onChange={(e) => set('model')(e.target.value)}
                placeholder="以服务商官方文档为准"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="api-key" className="text-sm font-medium">
                API Key
              </label>
              <input
                id="api-key"
                type="password"
                className={field}
                value={values.apiKey}
                onChange={(e) => set('apiKey')(e.target.value)}
                placeholder={status?.configured ? '留空表示继续使用已保存的 Key' : 'sk-…'}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                只会保存在本机 ~/.orbit/settings.json（仅当前用户可读），页面和接口都不会再显示它。
              </p>
            </div>

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
              <Button type="submit" disabled={problem !== null || busy !== null}>
                {busy === 'save' ? '保存中…' : '保存'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={problem !== null || busy !== null}
                onClick={() => void run('test')}
              >
                {busy === 'test' ? '测试中…' : '测试连接'}
              </Button>
              {status?.source === 'settings' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run('clear')}
                >
                  清除已保存的设置
                </Button>
              )}
            </div>
          </form>
        </main>
      )}
    </div>
  );
}
