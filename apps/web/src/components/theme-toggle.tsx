import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Theme } from '@/lib/theme';

const LABEL: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle({ theme, onCycle }: { theme: Theme; onCycle: () => void }) {
  const Icon = ICON[theme];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onCycle}
      aria-label={`主题：${LABEL[theme]}，点击切换`}
      title={`主题：${LABEL[theme]}`}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  );
}
