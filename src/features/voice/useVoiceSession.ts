import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiAvailable, understand } from '../../lib/ai/assistant';
import { parseInput } from '../../lib/parser';
import { speak, speechOutputSupported, stopSpeaking } from '../../lib/speech/speak';
import { useSpeechRecognition } from '../../lib/speech/useSpeechRecognition';
import { createVoiceAgent, type VoiceTurn } from '../../lib/voice/agent';
import type { Profile } from '../../lib/types';
import { useUi } from '../../store/ui';

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface Exchange {
  id: number;
  heard: string;
  turn: VoiceTurn;
}

/** How long a pause means "I'm finished", so a breath mid-sentence doesn't cut the command in half. */
const PAUSE_MS = 1300;
/** The microphone stops by itself after this long without anyone speaking. */
const QUIET_LIMIT_MS = 120_000;
const REPLIES_KEY = 'dayflow-voice-replies';

const readReplies = (): boolean => {
  try {
    return localStorage.getItem(REPLIES_KEY) !== 'off';
  } catch {
    return true;
  }
};

/** Spoken answers are English, so Urdu or Arabic recognition still gets a voice that can read them. */
const replyLang = (voiceLang: string): string => (voiceLang.toLowerCase().startsWith('en') ? voiceLang : 'en-US');

/**
 * The hands-free assistant. It lives for as long as the app does, so it keeps listening while you
 * move around; `active` is the one switch. While active it listens, waits for a pause, acts,
 * answers out loud, then listens again.
 */
export function useVoiceSession(profile: Pick<Profile, 'voiceLang'>, active: boolean, stop: () => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [log, setLog] = useState<Exchange[]>([]);
  const [replies, setRepliesState] = useState(readReplies);
  const nextId = useRef(1);
  const buffer = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  /** Bumped whenever the assistant is switched off, so an answer that arrives late is dropped. */
  const generation = useRef(0);
  const lastActivity = useRef(Date.now());
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const activeRef = useRef(active);
  activeRef.current = active;
  const repliesRef = useRef(replies);
  repliesRef.current = replies;

  const agent = useMemo(
    () =>
      createVoiceAgent({
        // Gemini when it's on; the built-in parser otherwise, and whenever Gemini can't answer
        understand: async (text, ctx, existing) => {
          if (aiAvailable()) {
            try {
              return await understand(text, ctx, existing);
            } catch {
              /* quota, network or a bad answer: the rules below still handle it */
            }
          }
          return parseInput(text, ctx);
        },
        get smart() {
          return aiAvailable();
        },
        now: () => Date.now(),
      }),
    [],
  );

  const speech = useSpeechRecognition(
    profile.voiceLang,
    (phrase) => {
      if (!phrase || busy.current || !activeRef.current) return;
      lastActivity.current = Date.now();
      buffer.current = `${buffer.current} ${phrase}`.trim();
      setHeard(buffer.current);
      schedule();
    },
    { ignoreNoSpeech: true },
  );
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const run = useCallback(
    async (text: string, spoken: boolean) => {
      if (busy.current) return;
      busy.current = true;
      const mine = generation.current;
      lastActivity.current = Date.now();
      clearTimeout(timer.current);
      buffer.current = '';
      speechRef.current.stop();
      setHeard('');
      setPhase('thinking');

      const turn = await agent.hear(text);
      if (mine !== generation.current) return; // switched off while thinking
      if (turn.say) setLog((l) => [...l.slice(-19), { id: nextId.current++, heard: text.trim(), turn }]);

      if (turn.end) {
        busy.current = false;
        setPhase('idle');
        stopRef.current();
        return;
      }
      if (spoken && repliesRef.current && turn.say) {
        setPhase('speaking');
        await speak(turn.say, replyLang(profile.voiceLang));
        if (mine !== generation.current) return;
      }
      lastActivity.current = Date.now();
      busy.current = false;
      setPhase('idle');
    },
    [agent, profile.voiceLang],
  );

  function schedule() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (buffer.current.trim()) void run(buffer.current, true);
    }, PAUSE_MS);
  }

  // someone still talking keeps the sentence open
  useEffect(() => {
    if (speech.interim && buffer.current) {
      lastActivity.current = Date.now();
      schedule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.interim]);

  // switched on (a click, so the browser allows the microphone) or off
  useEffect(() => {
    if (active) {
      lastActivity.current = Date.now();
      speechRef.current.start();
      return;
    }
    generation.current += 1;
    busy.current = false;
    clearTimeout(timer.current);
    buffer.current = '';
    setHeard('');
    setPhase('idle');
    speechRef.current.stop();
    stopSpeaking();
  }, [active]);

  // keep listening between sentences
  useEffect(() => {
    if (!active || phase !== 'idle' || speech.listening || !speech.supported || speech.error) return;
    const id = setTimeout(() => speechRef.current.start(), 250);
    return () => clearTimeout(id);
  }, [active, phase, speech.listening, speech.supported, speech.error]);

  useEffect(() => {
    if (!active) return;
    if (phase === 'idle' && speech.listening) setPhase('listening');
    if (phase === 'listening' && !speech.listening) setPhase('idle');
  }, [active, phase, speech.listening]);

  // an open microphone nobody is using switches itself off
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (!busy.current && Date.now() - lastActivity.current > QUIET_LIMIT_MS) {
        useUi.getState().toast('Voice turned off after a quiet couple of minutes. Tap the mic to talk again.');
        stopRef.current();
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      stopSpeaking();
    },
    [],
  );

  return {
    active,
    phase: active ? phase : ('idle' as Phase),
    heard: heard || (active ? speech.interim : ''),
    log,
    supported: speech.supported,
    error: active ? speech.error : null,
    replies,
    canSpeak: speechOutputSupported(),
    /** Cuts off the answer being spoken. */
    skipSpeech: () => stopSpeaking(),
    /** Typed commands go through the same agent, without a spoken answer. */
    send: (text: string) => run(text, false),
    setReplies: (on: boolean) => {
      setRepliesState(on);
      if (!on) stopSpeaking();
      try {
        localStorage.setItem(REPLIES_KEY, on ? 'on' : 'off');
      } catch {
        /* the choice just won't be remembered */
      }
    },
  };
}

export type VoiceSession = ReturnType<typeof useVoiceSession>;
