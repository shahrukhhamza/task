import { useEffect } from 'react';
import type { Profile } from './types';

const KEY = 'dayflow-theme';

export function applyTheme(theme: Profile['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f172a' : '#0f766e');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the profile still holds the choice */
  }
}

/** Keeps the page in sync with the saved theme, following the OS when set to "system". */
export function useTheme(theme: Profile['theme']): void {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);
}
