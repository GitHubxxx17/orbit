import { ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** What the control is for, read out by screen readers; the visible text is the current choice. */
  label: string;
  disabled?: boolean;
  /** Cap on the width of the button, for long names. */
  className?: string;
}

/**
 * A small dropdown that looks like the rest of the app. The browser's own select draws a dark
 * system menu that cannot be styled, so the choices are a themed menu instead. Keyboard and
 * screen-reader behaviour comes from the menu primitive (arrows, Enter, Escape, type-ahead).
 */
export function MenuSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className = '',
}: Props<T>) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`${label}：${current?.label ?? ''}`}
        className={`flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${className}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-auto min-w-36">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
