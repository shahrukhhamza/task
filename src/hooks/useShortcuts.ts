import { useEffect } from 'react';
import { useUi } from '../store/ui';

const isTyping = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  return node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
};

/** "/" opens the add sheet and "V" the voice assistant, unless you're typing; Ctrl/Cmd+K works anywhere. */
export function useShortcuts(): void {
  const focusInput = useUi((s) => s.openAdd);
  const openVoice = useUi((s) => s.openVoice);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusInput();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        focusInput();
      } else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        openVoice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusInput, openVoice]);
}
