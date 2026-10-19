import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiAvailable, understand } from '../../lib/ai/assistant';
import { parseInput } from '../../lib/parser';
import { speak, speechOutputSupported, stopSpeaking } from '../../lib/speech/speak';
import { useSpeechRecognition } from '../../lib/speech/useSpeechRecognition';
import { createVoiceAgent, type VoiceTurn } from '../../lib/voice/agent';
import type { Profile } from '../../lib/types';

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface Exchange {
  id: number;
  heard: string;
  turn: VoiceTurn;
}

/** How long a pause means "I'm finished", so a breath mid-sentence doesn't cut the command in half. */
const PAUSE_MS = 1300;
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
 * One hands-free conversation: it listens, waits for a pause, acts, answers out loud,
 * then listens again until the user stops or closes it.
 */
export function useVoiceSession(profile: Pick<Profile, 'voiceLang'>, onEnd: () => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [handsFree, setHandsFree] = useState(true);
  const [heard, setHeard] = useState('');
  const [log, setLog] = useState<Exchange[]>([]);
  const [replies, setRepliesState] = useState(readReplies);
  const nextId = useRef(1);
  const buffer = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  const alive = useRef(true);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
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
      if (!phrase || busy.current) return;
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
      clearTimeout(timer.current);
      buffer.current = '';
      speechRef.current.stop();
      setHeard('');
      setPhase('thinking');

      const turn = await agent.hear(text);
      if (!alive.current) return;
      if (turn.say) setLog((l) => [...l.slice(-19), { id: nextId.current++, heard: text.trim(), turn }]);

      if (turn.end) {
        busy.current = false;
        onEndRef.current();
        return;
      }
      if (spoken && repliesRef.current && turn.say) {
        setPhase('speaking');
        await speak(turn.say, replyLang(profile.voiceLang));
        if (!alive.current) return;
      }
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
    if (speech.interim && buffer.current) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.interim]);

  // listen (again) whenever nothing else is going on
  useEffect(() => {
    if (!handsFree || phase !== 'idle' || speech.listening || !speech.supported || speech.error) return;
    const id = setTimeout(() => speechRef.current.start(), 250);
    return () => clearTimeout(id);
  }, [handsFree, phase, speech.listening, speech.supported, speech.error]);

  useEffect(() => {
    if (phase === 'idle' && speech.listening) setPhase('listening');
    if (phase === 'listening' && !speech.listening) setPhase('idle');
  }, [phase, speech.listening]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      stopSpeaking();
      agent.reset();
    };
  }, [agent]);

  return {
    phase,
    heard: heard || speech.interim,
    interim: speech.interim,
    log,
    supported: speech.supported,
    error: speech.error,
    handsFree,
    replies,
    canSpeak: speechOutputSupported(),
    /** The big button: pause when listening, resume otherwise. */
    toggle: () => {
      if (phase === 'speaking') {
        stopSpeaking();
        return;
      }
      if (handsFree || speech.listening) {
        setHandsFree(false);
        clearTimeout(timer.current);
        buffer.current = '';
        setHeard('');
        speech.stop();
      } else {
        setHandsFree(true);
      }
    },
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
