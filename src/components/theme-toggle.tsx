'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-provider';

/** Shared by the public header and the studio shell; dark is the pressed state. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" className={`theme-toggle ${className}`} onClick={toggleTheme} aria-label="Toggle color theme" aria-pressed={theme === 'dark'} title="Switch between day and night">
    <Sun className="theme-day" size={19} strokeWidth={1.5} aria-hidden="true" />
    <Moon className="theme-night" size={19} strokeWidth={1.5} aria-hidden="true" />
  </button>;
}