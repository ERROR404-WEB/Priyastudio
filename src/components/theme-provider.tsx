'use client';

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
const key = 'hey-priya-theme';
const eventName = 'hey-priya-theme-change';
let memoryPreference: Theme | undefined;

// A synchronous head script: only validated theme names ever reach the DOM.
// Storage can throw in privacy modes; OS preference must still work there.
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem('${key}')}catch(e){}if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t})()` }} />;
}

function preference(): Theme | undefined {
  if (memoryPreference) return memoryPreference;
  try {
    const stored = localStorage.getItem(key);
    return stored === 'dark' || stored === 'light' ? stored : undefined;
  } catch { return undefined; }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(eventName));
}

function subscribe(notify: () => void) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const sync = () => applyTheme(preference() ?? (media.matches ? 'dark' : 'light'));
  const storage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    memoryPreference = undefined;
    sync();
  };
  window.addEventListener(eventName, notify);
  window.addEventListener('storage', storage);
  media.addEventListener('change', sync);
  sync();
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener('storage', storage);
    media.removeEventListener('change', sync);
  };
}

function snapshot(): Theme { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
function serverSnapshot(): Theme { return 'light'; }
function toggleTheme() {
  const next = snapshot() === 'dark' ? 'light' : 'dark';
  memoryPreference = next;
  try { localStorage.setItem(key, next); } catch { /* Keep this session usable without storage. */ }
  applyTheme(next);
}

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeToggle must be inside the root ThemeProvider.');
  return value;
}