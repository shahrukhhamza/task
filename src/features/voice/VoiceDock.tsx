import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2, Mic, Send, Sparkles, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useUi } from '../../store/ui';
import { useVoice } from './VoiceProvider';
import type { Exchange, Phase } from './useVoiceSession';

const SUGGESTIONS = ['Add a meeting from 5 to 6 pm', 'What’s on today?', 'Delete task 1', 'Undo'];

const STATUS: Record<Phase, string> = {
  idle: 'Starting…',
  listening: 'Listening',
  thinking: 'On it…',
  speaking: 'Speaking · tap to skip',
};

/** The one button that turns the assistant on and off, wherever you are in the app. */
export function VoiceButton() {
  const on = useUi((s) => s.voiceOn);
  const toggle = useUi((s) => s.toggleVoice);
  const voice = useVoice();
  const speaking = on && voice.phase === 'speaking';
  const thinking = on && voice.phase === 'thinking';

  const look = !on
    ? 'bg-fg text-app dark:bg-card-lime dark:text-ink'
    : speaking
      ? 'bg-card-lime text-ink'
      : thinking
        ? 'bg-surface-2 text-fg ring-1 ring-line'
        : 'mic-live bg-red-600 text-white';

  return (
    <button
      type="button"
      onClick={() => (speaking ? voice.skipSpeech() : toggle())}
      aria-pressed={on}
      aria-label={on ? (speaking ? 'Skip the answer' : 'Stop listening') : 'Talk to Dayflow'}
      title={on ? 'Stop listening (V)' : 'Talk to Dayflow (V)'}
      className={`fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition hover:scale-105 lg:bottom-8 lg:right-8 ${look}`}
    >
      {thinking ? <Loader2 size={24} className="animate-spin" /> : speaking ? <Volume2 size={24} /> : <Mic size={24} />}
    </button>
  );
}

function Reply({ item, latest, onUndo, onPick }: { item: Exchange; latest: boolean; onUndo: () => void; onPick: (label: string) => void }) {
  const { turn } = item;
  const Icon = turn.tone === 'ok' ? Check : turn.tone === 'error' ? AlertCircle : Sparkles;
  const badge = turn.tone === 'ok' ? 'bg-card-lime text-ink' : turn.tone === 'error' ? 'bg-card-coral text-ink' : 'bg-card-lilac text-ink';
  return (
    <li className="grid gap-2">
      <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2 text-sm text-fg">{item.heard}</p>
      <div className="flex max-w-[94%] items-start gap-2.5">
        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${badge}`}>
          <Icon size={13} strokeWidth={2.6} aria-hidden />
        </span>
        <div className="grid gap-2">
          <p className="text-sm font-medium leading-snug">{turn.say}</p>
          {latest && turn.options && (
            <div className="flex flex-wrap gap-1.5">
              {turn.options.map((label) => (
                <button key={label} type="button" onClick={() => onPick(label)} className="rounded-full border border-line px-3 py-1 text-[13px] font-medium hover:bg-surface-2">
                  {label}
                </button>
              ))}
            </div>
          )}
          {latest && turn.undo && (
            <button type="button" onClick={onUndo} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium hover:brightness-95">
              <Undo2 size={13} /> Undo
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * A small panel that floats above the app while the assistant is on: what it heard and what it did.
 * Nothing is blocked, so you can keep tapping around (or navigate) while you talk.
 */
export function VoicePanel() {
  const on = useUi((s) => s.voiceOn);
  const stop = useUi((s) => s.setVoice);
  const voice = useVoice();
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const { log } = voice;
  const latest = log[log.length - 1];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [log.length, expanded]);

  if (!on) return null;

  const submit = (text: string) => {
    const value = text.trim();
    if (!value) return;
    setTyped('');
    void voice.send(value);
  };

  const status = !voice.supported ? 'Voice isn’t available here' : voice.heard ? `“${voice.heard}”` : STATUS[voice.phase];

  return (
    <section
      aria-label="Voice assistant"
      className="rise fixed inset-x-3 bottom-[calc(10.5rem+env(safe-area-inset-bottom))] z-40 rounded-[26px] border border-line bg-surface text-fg shadow-2xl lg:inset-x-auto lg:bottom-28 lg:right-8 lg:w-[400px]"
    >
      <header className="flex items-center gap-2 px-4 py-3">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${voice.phase === 'listening' ? 'animate-pulse bg-red-600' : voice.phase === 'speaking' ? 'bg-card-lime' : 'bg-muted'}`}
        />
        <p role="status" aria-live="polite" className={`min-w-0 flex-1 truncate text-sm ${voice.heard ? 'italic text-muted' : 'font-semibold'}`}>
          {status}
        </p>
        {voice.canSpeak && (
          <button
            type="button"
            onClick={() => voice.setReplies(!voice.replies)}
            aria-pressed={voice.replies}
            aria-label={voice.replies ? 'Turn spoken answers off' : 'Turn spoken answers on'}
            title={voice.replies ? 'Spoken answers on' : 'Spoken answers off'}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
          >
            {voice.replies ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Show less' : 'Show the conversation'}
          title={expanded ? 'Show less' : 'Show the conversation'}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
        >
          {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        <button type="button" onClick={() => stop(false)} aria-label="Stop listening" title="Stop listening" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
          <X size={18} />
        </button>
      </header>

      <div className="grid gap-3 border-t border-line px-4 pb-4 pt-3">
        {!voice.supported && (
          <p role="alert" className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">
            This browser can’t listen for speech. Chrome, Edge and Safari work best. You can still type commands below.
          </p>
        )}
        {voice.error && (
          <p role="alert" className="tint rounded-2xl bg-card-coral p-3 text-sm font-medium text-ink">
            {voice.error}
          </p>
        )}

        {expanded ? (
          <div className="max-h-[40dvh] overflow-y-auto pr-1" tabIndex={0} role="region" aria-label="Conversation">
            {log.length ? (
              <ul className="grid gap-4">
                {log.map((item, i) => (
                  <Reply key={item.id} item={item} latest={i === log.length - 1} onUndo={() => submit('undo')} onPick={submit} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing yet. Just say what you need.</p>
            )}
            <div ref={bottom} />
          </div>
        ) : latest ? (
          <ul>
            <Reply item={latest} latest onUndo={() => submit('undo')} onPick={submit} />
          </ul>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2">
                {s}
              </button>
            ))}
          </div>
        )}

        {(expanded || !voice.supported) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(typed);
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor="voice-typed" className="sr-only">
              Type a command instead
            </label>
            <input
              id="voice-typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Or type a command…"
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm text-fg placeholder:text-muted focus:border-fg/30 focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!typed.trim() || voice.phase === 'thinking'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fg text-app transition disabled:opacity-40 dark:bg-card-lime dark:text-ink"
            >
              <Send size={16} />
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

/** The always-there mic button and the panel that appears while it's on. */
export function VoiceDock() {
  return (
    <>
      <VoicePanel />
      <VoiceButton />
    </>
  );
}
