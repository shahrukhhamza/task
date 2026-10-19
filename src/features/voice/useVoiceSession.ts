import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiAvailable, understand } from '../../lib/ai/assistant';
import { speak, speechOutputSupported, stopSpeaking, warmUpSpeech } from '../../lib/speech/speak';
import { useSpeechRecognition } from '../../lib/speech/useSpeechRecognition';
import { createVoiceAgent, type VoiceTurn } from '../../lib/voice/agent';
import { isEcho } from '../../lib/voice/echo';
import { fastUnderstand } from '../../lib/voice/fastUnderstand';
import type { Profile } from '../../lib/types';
import { useUi } from '../../store/ui';

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface Exchange {
  id: number;
  heard: string;
  turn: VoiceTurn;
}

/**
 * Speed. The browser decides a sentence is over after roughly a second of silence; waiting for that
 * is the slowest part of talking to an app. So when the words stop changing for INTERIM_WAIT_MS the
 * live transcript is used as it is, and a finished sentence only waits FINAL_WAIT_MS in case you
 * carry straight on.
 */
const FINAL_WAIT_MS = 250;
const INTERIM_WAIT_MS = 700;
/** After the assistant stops talking, what the microphone heard while it spoke is still arriving. */
const AFTER_SPEECH_MS = 700;
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
 * move around; `active` is the one switch. The microphone stays open the whole time (restarting it
 * after every answer would cost half a second), so what it hears while it is talking is ignored.
 */
export function useVoiceSession(profile: Pick<Profile, 'voiceLang'>, active: boolean, stop: () => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [log, setLog] = useState<Exchange[]>([]);
  const [replies, setRepliesState] = useState(readReplies);
  const nextId = useRef(1);
  const buffer = useRef('');
  const interimRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  /** Bumped whenever the assistant is switched off, so an answer that arrives late is dropped. */
  const generation = useRef(0);
  const lastActivity = useRef(Date.now());
  /** Don't listen to anything until this moment (while it speaks, and just after). */
  const deafUntil = useRef(0);
  const recent = useRef<{ spoken?: { text: string; at: number }; handled?: { text: string; at: number } }>({});
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const activeRef = useRef(active);
  activeRef.current = active;
  const repliesRef = useRef(replies);
  repliesRef.current = replies;

  const agent = useMemo(
    () =>
      createVoiceAgent({
        // The built-in parser answers at once when it is sure; Gemini is for what it can't read
        understand: (text, ctx, existing) => fastUnderstand(text, ctx, existing, { available: aiAvailable, understand }),
        get smart() {
          return aiAvailable();
        },
        now: () => Date.now(),
      }),
    [],
  );

  const listening = () => activeRef.current && !busy.current && Date.now() >= deafUntil.current;

  const speech = useSpeechRecognition(
    profile.voiceLang,
    (phrase) => {
      if (!phrase || !listening()) return;
      if (isEcho(phrase, recent.current, Date.now())) return;
      lastActivity.current = Date.now();
      buffer.current = `${buffer.current} ${phrase}`.trim();
      interimRef.current = '';
      setHeard(buffer.current);
      schedule(FINAL_WAIT_MS);
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
      interimRef.current = '';
      recent.current.handled = { text, at: Date.now() };
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
        const out = turn.speak ?? turn.say;
        recent.current.spoken = { text: out, at: Date.now() };
        deafUntil.current = Number.POSITIVE_INFINITY;
        setPhase('speaking');
        await speak(out, replyLang(profile.voiceLang));
        if (mine !== generation.current) return;
        deafUntil.current = Date.now() + AFTER_SPEECH_MS;
      }
      lastActivity.current = Date.now();
      recent.current.handled = { text, at: Date.now() };
      busy.current = false;
      setPhase('idle');
    },
    [agent, profile.voiceLang],
  );

  function schedule(waitMs: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const text = `${buffer.current} ${interimRef.current}`.trim();
      if (text) void run(text, true);
    }, waitMs);
  }

  // words still changing keep the sentence open; once they settle, it is used without waiting for the browser's "final"
  useEffect(() => {
    if (!speech.interim) return;
    if (!listening()) return;
    interimRef.current = speech.interim;
    lastActivity.current = Date.now();
    schedule(INTERIM_WAIT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.interim]);

  // switched on (a click, so the browser allows the microphone and the voice) or off
  useEffect(() => {
    if (active) {
      lastActivity.current = Date.now();
      deafUntil.current = 0;
      speechRef.current.start();
      warmUpSpeech(replyLang(profile.voiceLang));
      return;
    }
    generation.current += 1;
    busy.current = false;
    clearTimeout(timer.current);
    buffer.current = '';
    interimRef.current = '';
    setHeard('');
    setPhase('idle');
    speechRef.current.stop();
    stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // the browser ends a session now and then; start the next one straight away
  useEffect(() => {
    if (!active || speech.listening || !speech.supported || speech.error) return;
    const id = setTimeout(() => speechRef.current.start(), 60);
    return () => clearTimeout(id);
  }, [active, speech.listening, speech.supported, speech.error]);

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

  const showing = active && phase !== 'speaking' && phase !== 'thinking';
  return {
    active,
    phase: active ? phase : ('idle' as Phase),
    heard: heard || (showing ? speech.interim : ''),
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
