import { useState, type FormEvent } from 'react';

import {
  removeModel,
  saveModel,
  setDefaultModel,
  testModel,
  type ModelList,
  type ModelProfile,
} from '@/api';
import { BalanceCard } from '@/components/balance-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBalance } from '@/hooks/use-balance';
import { useModels } from '@/hooks/use-models';
import {
  BASE_URL_PRESETS,
  modelFormInput,
  modelFormProblem,
  type ModelFormValues,
} from '@/lib/model-form';

const field =
  'h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';

const EMPTY: ModelFormValues = { label: '', baseUrl: '', model: '', apiKey: '' };

type Notice = { kind: 'ok' | 'error'; text: string } | null;

interface Props {
  /** A saved model changed; the app should read the server info and model list again. */
  onChanged: () => void;
}

/** `new` is the blank form, an id edits that model, null shows only the list. */
type Editing = string | 'new' | null;

export function ModelsSection({ onChanged }: Props) {
  const { list, failed, adopt } = useModels();
  const [editing, setEditing] = useState<Editing>(null);
  const [values, setValues] = useState<ModelFormValues>(EMPTY);
  const [busy, setBusy] = useState<'save' | 'test' | 'list' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const profile = list.models.find((m) => m.id === editing);
  // Asked again after a save, since that may be a different account.
  const balance = useBalance(
    `${profile?.model ?? ''}:${profile?.apiKeyHint ?? ''}`,
    profile?.source === 'settings',
    profile?.id,
  );

  const set = (key: keyof ModelFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const open = (target: ModelProfile | 'new') => {
    setNotice(null);
    setConfirmDelete(null);
    if (target === 'new') {
      setEditing('new');
      setValues(EMPTY);
    } else {
      // The key is never sent back, so its field stays empty.
      setEditing(target.id);
      setValues({
        label: target.label === target.model ? '' : target.label,
        baseUrl: target.baseUrl,
        model: target.model,
        apiKey: '',
      });
    }
  };

  const problem = modelFormProblem(values, profile !== undefined);

  /** Run a request, show what came of it, and tell the app the models changed. */
  const change = async (kind: 'save' | 'list', request: () => Promise<ModelList>, done: string) => {
    setBusy(kind);
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
      setBusy(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem || busy !== null || editing === null) return;
    const id = editing === 'new' ? null : editing;
    const ok = await change(
      'save',
      () => saveModel(id, modelFormInput(values)),
      id === null ? '已添加，新的运行可以选用它' : '已保存，新的运行立即生效',
    );
    if (ok) setEditing(null);
  };

  const test = async () => {
    if (problem || busy !== null) return;
    setBusy('test');
    setNotice(null);
    try {
      const result = await testModel({
        ...modelFormInput(values),
        ...(profile ? { id: profile.id } : {}),
      });
      setNotice({
        kind: result.ok ? 'ok' : 'error',
        text: result.ok
          ? `连接成功（${result.latencyMs ?? '?'} ms）`
          : `连接失败：${result.message}`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const makeDefault = (id: string) => {
    void change('list', () => setDefaultModel(id), '已设为默认模型');
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    const ok = await change('list', () => removeModel(id), '已删除');
    if (ok && editing === id) setEditing(null);
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-8" aria-label="模型设置">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">模型</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              任何兼容 OpenAI
              接口的服务都可以。保存后无需重启；新对话用默认模型，也可以在输入框旁临时换一个。
            </p>
          </div>
          <Button type="button" disabled={busy !== null} onClick={() => open('new')}>
            添加模型
          </Button>
        </header>

        {failed && (
          <p role="alert" className="text-sm text-destructive">
            读取当前设置失败，请确认服务端在运行。
          </p>
        )}

        {list.models.length === 0 && !failed && (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            还没有模型。点「添加模型」，填好接口地址、模型名和 API Key。
          </p>
        )}

        <ul className="space-y-2" aria-label="已配置的模型">
          {list.models.map((model) => (
            <li key={model.id} className="rounded-xl border bg-card/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium">{model.label}</span>
                {model.id === list.defaultId && <Badge variant="secondary">默认</Badge>}
                {model.source === 'env' && <Badge variant="outline">来自 .env</Badge>}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {model.model} · {model.baseUrl} · Key …{model.apiKeyHint}
              </p>
              {model.source === 'settings' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {model.id !== list.defaultId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => makeDefault(model.id)}
                    >
                      设为默认
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => open(model)}
                  >
                    编辑
                  </Button>
                  {confirmDelete === model.id ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy !== null}
                        onClick={() => void remove(model.id)}
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
                      disabled={busy !== null}
                      onClick={() => setConfirmDelete(model.id)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  来自环境变量，不能在这里修改；添加一个模型后会用它取代。
                </p>
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
            aria-label={editing === 'new' ? '添加模型' : '编辑模型'}
          >
            <h2 className="text-sm font-semibold">{editing === 'new' ? '添加模型' : '编辑模型'}</h2>

            {profile?.source === 'settings' && (
              <BalanceCard
                balance={balance.balance}
                loading={balance.loading}
                onRefresh={() => void balance.refresh(true)}
              />
            )}

            <div className="space-y-1.5">
              <label htmlFor="model-label" className="text-sm font-medium">
                显示名称
              </label>
              <input
                id="model-label"
                className={field}
                value={values.label}
                onChange={(e) => set('label')(e.target.value)}
                placeholder="可选，留空则用模型名称"
                autoComplete="off"
              />
            </div>

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
                placeholder={profile ? '留空表示继续使用已保存的 Key' : 'sk-…'}
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
                onClick={() => void test()}
              >
                {busy === 'test' ? '测试中…' : '测试连接'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
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
