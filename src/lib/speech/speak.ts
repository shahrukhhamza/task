// Spoken replies through the browser's built-in voices (no cost, works offline on most devices).

import { toSpeech } from './toSpeech';
import { chooseVoice } from './voices';

export const speechOutputSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export interface VoicePrefs {
  /** The voice the user picked; empty means "the most natural one this device has". */
  voiceURI?: string;
  /** 0.7 (slow) to 1.4 (fast). */
  rate: number;
}

const PREFS_KEY = 'dayflow-assistant-voice';
export const DEFAULT_VOICE_PREFS: VoicePrefs = { rate: 1.05 };

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<VoicePrefs>;
    const rate = typeof raw.rate === 'number' ? Math.min(1.4, Math.max(0.7, raw.rate)) : DEFAULT_VOICE_PREFS.rate;
    return { voiceURI: typeof raw.voiceURI === 'string' && raw.voiceURI ? raw.voiceURI : undefined, rate };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* the choice just won't be remembered */
  }
}

/** Resolves when the sentence has been spoken (or immediately when speech isn't available). */
export function speak(text: string, lang: string, prefs: VoicePrefs = loadVoicePrefs()): Promise<void> {
  const spoken = toSpeech(text);
  if (!speechOutputSupported() || !spoken) return Promise.resolve();
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = lang;
    const voice = chooseVoice(synth.getVoices(), lang, prefs.voiceURI);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = prefs.rate;
    utterance.pitch = 1;
    // some browsers never fire `end` for a cancelled or failed utterance, so never wait forever
    const guard = setTimeout(resolve, Math.min(30_000, 2500 + spoken.length * 90));
    const done = () => {
      clearTimeout(guard);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
