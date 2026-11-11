import { SegmentedControl, type Theme, useTheme } from '@realtimedocs/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

export const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const ICONS: Record<Theme, ReactNode> = {
  dark: <Moon />,
  light: <Sun />,
  system: <Monitor />,
};

export interface ThemeControlProps {
  /** Icons only, for tight bars. Labels stay available to assistive technology. */
  compact?: boolean;
  className?: string;
}

/** Dark, light, or follow the operating system. Saved in this browser. */
export function ThemeControl({ compact = false, className }: ThemeControlProps) {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl
      className={className}
      ariaLabel="Theme"
      size="sm"
      iconOnly={compact}
      value={theme}
      onValueChange={setTheme}
      options={THEME_OPTIONS.map((option) => ({ ...option, icon: ICONS[option.value] }))}
    />
  );
}
