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

  /** The add sheet (opened by the + button, "/" and Ctrl+K), optionally with text already in it. */
  addOpen: boolean;
  addText: string;
  openAdd: (text?: string) => void;
  closeAdd: () => void;

  /** The hands-free voice assistant is listening. */
  voiceOn: boolean;
  setVoice: (on: boolean) => void;
  toggleVoice: () => void;

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

  addOpen: false,
  addText: '',
  openAdd: (text = '') => set({ addOpen: true, addText: text, selectedTaskId: null }),
  closeAdd: () => set({ addOpen: false, addText: '' }),

  voiceOn: false,
  setVoice: (voiceOn) => set({ voiceOn }),
  toggleVoice: () => set((s) => ({ voiceOn: !s.voiceOn })),

  selectedTaskId: null,
  select: (selectedTaskId) => set({ selectedTaskId }),

  focusTarget: null,
  startFocus: (taskId) => set({ focusTarget: { taskId }, selectedTaskId: null }),
  stopFocus: () => set({ focusTarget: null }),
}));
