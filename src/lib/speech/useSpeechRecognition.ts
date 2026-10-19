import { useCallback, useEffect, useRef, useState } from 'react';

/** The Web Speech API is not in lib.dom; this is the slice we use. */
interface RecognitionResultItem {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResultItem>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const getCtor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const VOICE_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-AU', label: 'English (Australia)' },
  { code: 'ur-PK', label: 'Urdu (Pakistan)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
];

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.',
  'service-not-allowed': 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.',
  'no-speech': 'I didn’t hear anything. Try again a little closer to the mic.',
  'audio-capture': 'No microphone was found. Check that one is connected.',
  network: 'The speech service couldn’t be reached. Voice needs an internet connection; typing still works offline.',
  'language-not-supported': 'This browser doesn’t support that language for voice input.',
};

export interface SpeechState {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/** Final phrases are delivered to `onFinal`; the in-progress phrase is exposed as `interim`. */
export function useSpeechRecognition(lang: string, onFinal: (text: string) => void, opts: { ignoreNoSpeech?: boolean } = {}): SpeechState {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const ignoreNoSpeech = useRef(opts.ignoreNoSpeech ?? false);
  ignoreNoSpeech.current = opts.ignoreNoSpeech ?? false;

  const supported = typeof window !== 'undefined' && !!getCtor();

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    setInterim('');

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) onFinalRef.current(result[0].transcript.trim());
        else live += result[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      // a hands-free session just listens again after silence
      if (e.error === 'no-speech' && ignoreNoSpeech.current) return;
      setError(ERROR_MESSAGES[e.error] ?? `Voice input stopped (${e.error}).`);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };

    recognition.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('Voice input could not start. Try again in a moment.');
    }
  }, [lang]);

  const stop = useCallback(() => recognition.current?.stop(), []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, interim, error, start, stop };
}
