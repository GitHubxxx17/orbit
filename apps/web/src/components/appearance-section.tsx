import {
  FONT_LABEL,
  FONT_SIZES,
  WIDTH_LABEL,
  WIDTHS,
  type Appearance,
  type FontSize,
  type Width,
} from '@/lib/appearance';

interface Props {
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}

interface ChoiceProps<T extends string> {
  label: string;
  hint: string;
  options: readonly T[];
  names: Record<T, string>;
  value: T;
  onPick: (value: T) => void;
}

function Choice<T extends string>({ label, hint, options, names, value, onPick }: ChoiceProps<T>) {
  return (
    <div className="space-y-1.5">
      <div role="group" aria-label={label} className="flex items-center gap-3">
        <span className="w-20 text-sm font-medium">{label}</span>
        <div className="flex rounded-md bg-muted p-0.5 text-sm">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={value === option}
              onClick={() => onPick(option)}
              className={`rounded px-3 py-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                value === option
                  ? 'bg-background font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {names[option]}
            </button>
          ))}
        </div>
      </div>
      <p className="pl-23 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** How the conversation looks. Stored in this browser; the theme is the button in the top bar. */
export function AppearanceSection({ appearance, onChange }: Props) {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-8" aria-label="外观设置">
      <div className="mx-auto max-w-xl space-y-5">
        <header>
          <h1 className="text-lg font-semibold">外观</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            只影响这个浏览器，立即生效。主题请用顶部栏的按钮切换。
          </p>
        </header>

        <Choice<FontSize>
          label="消息字号"
          hint="智能体回答的文字大小"
          options={FONT_SIZES}
          names={FONT_LABEL}
          value={appearance.fontSize}
          onPick={(fontSize) => onChange({ ...appearance, fontSize })}
        />
        <Choice<Width>
          label="内容宽度"
          hint="对话和输入框的最大宽度"
          options={WIDTHS}
          names={WIDTH_LABEL}
          value={appearance.width}
          onPick={(width) => onChange({ ...appearance, width })}
        />

        <p className="rounded-xl border bg-card/50 p-3 text-(length:--msg-size) leading-relaxed">
          预览：这是一段示例回答，用来看字号和宽度合不合适。
        </p>
      </div>
    </main>
  );
}
