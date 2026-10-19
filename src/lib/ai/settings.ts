import { create } from 'zustand';

/**
 * Gemini settings live on this device only (never synced): the API key is a secret,
 * and each device can decide for itself whether to use AI.
 */
export interface AiSettings {
  enabled: boolean;
  key: string;
  /** Model picked automatically from what the key can use, e.g. "gemini-2.5-flash". */
  model: string;
}

const STORAGE_KEY = 'dayflow-ai';
const DEFAULTS: AiSettings = { enabled: false, key: '', model: '' };

function load(): AiSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

interface AiState extends AiSettings {
  /** Last problem talking to Gemini, shown in Settings. */
  error?: string;
  /** Whether the server (when signed in) has its own Gemini key. Not stored. */
  cloud: 'unknown' | 'yes' | 'no';
  setCloud: (cloud: AiState['cloud']) => void;
  update: (changes: Partial<AiSettings>) => void;
  setError: (error?: string) => void;
}

export const useAi = create<AiState>((set, get) => ({
  ...load(),
  update: (changes) => {
    const next = { enabled: get().enabled, key: get().key, model: get().model, ...changes };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode: settings last for this visit */
    }
    set({ ...next, error: undefined });
  },
  setError: (error) => set({ error }),
  cloud: 'unknown',
  setCloud: (cloud) => set({ cloud }),
}));

/** True when Gemini should be used from this device. */
export const aiReady = (s: Pick<AiSettings, 'enabled' | 'key'> = useAi.getState()): boolean => s.enabled && s.key.trim().length > 20;
