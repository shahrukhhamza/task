// Spoken replies through the browser's built-in voices (no cost, works offline on most devices).

import { toSpeech } from './toSpeech';
import { chooseVoice } from './voices';

export const speechOutputSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export interface VoicePrefs {
  /** The voice the user picked; empty means "the most natural one this device has". */
  voiceURI?: string;
  /** 0.7 (slow) to 1.4 (fast). */
  rate: number;
  /** Prefer a voice stored on this device: it starts talking at once, online voices need a moment. */
  instant?: boolean;
}

const PREFS_KEY = 'dayflow-assistant-voice';
export const DEFAULT_VOICE_PREFS: VoicePrefs = { rate: 1.05 };

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<VoicePrefs>;
    const rate = typeof raw.rate === 'number' ? Math.min(1.4, Math.max(0.7, raw.rate)) : DEFAULT_VOICE_PREFS.rate;
    return { voiceURI: typeof raw.voiceURI === 'string' && raw.voiceURI ? raw.voiceURI : undefined, rate, instant: raw.instant === true };
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
    const voice = chooseVoice(synth.getVoices(), lang, prefs.voiceURI, prefs.instant);
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

/**
 * The first utterance of a session is slow while the browser loads the voice. Saying something
 * silent right after the user taps the mic means the first real answer starts at once.
 */
export function warmUpSpeech(lang: string): void {
  if (!speechOutputSupported()) return;
  try {
    const synth = window.speechSynthesis;
    synth.getVoices();
    const quiet = new SpeechSynthesisUtterance('.');
    quiet.volume = 0;
    quiet.lang = lang;
    const prefs = loadVoicePrefs();
    const voice = chooseVoice(synth.getVoices(), lang, prefs.voiceURI, prefs.instant);
    if (voice) quiet.voice = voice;
    synth.speak(quiet);
  } catch {
    /* warming up is only an optimisation */
  }
}
