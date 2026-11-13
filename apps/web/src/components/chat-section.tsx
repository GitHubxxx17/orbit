import type { Preferences } from '@/lib/preferences';

interface Props {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
}

interface SwitchProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Switch({ id, label, hint, checked, onChange }: SwitchProps) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          aria-hidden
          className={`size-4 rounded-full bg-background shadow-sm transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-medium">
          {label}
        </p>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}

const APPROVALS = [
  { value: 'ask', label: '写入前询问我' },
  { value: 'readonly', label: '只读（拒绝写入）' },
] as const;

/** How the conversation behaves. Stored in this browser. */
export function ChatSection({ preferences, onChange }: Props) {
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    onChange({ ...preferences, [key]: value });

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-8" aria-label="聊天设置">
      <div className="mx-auto max-w-xl space-y-5">
        <header>
          <h1 className="text-lg font-semibold">聊天</h1>
          <p className="mt-1 text-sm text-muted-foreground">只影响这个浏览器，立即生效。</p>
        </header>

        <Switch
          id="pref-timestamps"
          label="显示时间"
          hint="在每个问题上方显示提问的时间"
          checked={preferences.showTimestamps}
          onChange={(value) => set('showTimestamps', value)}
        />
        <Switch
          id="pref-expand"
          label="工具调用默认展开"
          hint="过程里每一步的参数和输出直接展开，不用逐个点开"
          checked={preferences.expandTools}
          onChange={(value) => set('expandTools', value)}
        />
        <Switch
          id="pref-plain-diff"
          label="纯文本 diff"
          hint="修改内容不再用红绿底色标出增删，只显示文本"
          checked={preferences.plainDiff}
          onChange={(value) => set('plainDiff', value)}
        />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">默认审批方式</legend>
          <p className="text-xs text-muted-foreground">
            新打开页面时写文件的处理方式；输入框里仍可临时改。「只读」会直接拒绝所有写入。
          </p>
          <div
            role="group"
            aria-label="默认审批方式"
            className="flex w-fit rounded-md bg-muted p-0.5"
          >
            {APPROVALS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={preferences.defaultApproval === value}
                onClick={() => set('defaultApproval', value)}
                className={`rounded px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  preferences.defaultApproval === value
                    ? 'bg-background font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-muted-foreground">
          「内联显示思考过程」要等模型的推理事件做好之后再加（计划表里的「推理事件」）。
        </p>
      </div>
    </main>
  );
}
