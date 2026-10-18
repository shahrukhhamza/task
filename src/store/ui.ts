import { create } from 'zustand';
import type { Undo } from '../lib/db/actions';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  undo?: Undo;
}

interface FocusTarget {
  taskId: string;
}

interface UiState {
  toasts: Toast[];
  toast: (message: string, opts?: { undo?: Undo; tone?: Toast['tone'] }) => void;
  dismissToast: (id: number) => void;

  /** Bumped to ask the input bar to take focus (the "/" and Ctrl+K shortcuts). */
  inputFocusTick: number;
  focusInput: () => void;

  /** Text to drop into the input bar (used by the example chips in empty states). */
  draft: { text: string; tick: number };
  prefill: (text: string) => void;

  /** The task shown in the detail sheet. */
  selectedTaskId: string | null;
  select: (taskId: string | null) => void;

  focusTarget: FocusTarget | null;
  startFocus: (taskId: string) => void;
  stopFocus: () => void;
}

let nextToastId = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  toast: (message, opts = {}) => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone: opts.tone ?? 'info', undo: opts.undo }] }));
    // errors and undo prompts stay a little longer
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), opts.undo || opts.tone === 'error' ? 8000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  inputFocusTick: 0,
  focusInput: () => set((s) => ({ inputFocusTick: s.inputFocusTick + 1 })),

  draft: { text: '', tick: 0 },
  prefill: (text) => set((s) => ({ draft: { text, tick: s.draft.tick + 1 }, inputFocusTick: s.inputFocusTick + 1 })),

  selectedTaskId: null,
  select: (selectedTaskId) => set({ selectedTaskId }),

  focusTarget: null,
  startFocus: (taskId) => set({ focusTarget: { taskId }, selectedTaskId: null }),
  stopFocus: () => set({ focusTarget: null }),
}));
