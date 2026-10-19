import { AlertCircle, Check, Loader2, Mic, MicOff, Send, Sparkles, Undo2, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import type { Profile } from '../../lib/types';
import { useUi } from '../../store/ui';
import { useVoiceSession, type Exchange, type Phase } from './useVoiceSession';

const SUGGESTIONS = ['Add a meeting from 5 to 6 pm', 'Gym tomorrow at 7 am', 'What’s on today?', 'Remove this', 'Undo'];

const STATUS: Record<Phase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening… just say it',
  thinking: 'On it…',
  speaking: 'Speaking… tap to skip',
};

function Orb({ phase, handsFree, supported, onClick }: { phase: Phase; handsFree: boolean; supported: boolean; onClick: () => void }) {
  const live = phase === 'listening';
  const tone =
    phase === 'thinking'
      ? 'bg-surface-2 text-fg'
      : phase === 'speaking'
        ? 'bg-card-lime text-ink'
        : live
          ? 'mic-live bg-red-600 text-white'
          : 'bg-fg text-app dark:bg-card-lime dark:text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!supported || phase === 'thinking'}
      aria-label={live || (handsFree && phase !== 'speaking') ? 'Pause listening' : phase === 'speaking' ? 'Stop speaking' : 'Start listening'}
      className={`flex h-24 w-24 items-center justify-center rounded-full shadow-lg transition disabled:cursor-not-allowed ${tone}`}
    >
      {!supported ? <MicOff size={34} /> : phase === 'thinking' ? <Loader2 size={34} className="animate-spin" /> : phase === 'speaking' ? <Volume2 size={34} /> : <Mic size={34} />}
    </button>
  );
}

function Reply({ item, latest, onUndo, onPick }: { item: Exchange; latest: boolean; onUndo: () => void; onPick: (label: string) => void }) {
  const { turn } = item;
  const Icon = turn.tone === 'ok' ? Check : turn.tone === 'error' ? AlertCircle : Sparkles;
  const badge = turn.tone === 'ok' ? 'bg-card-lime text-ink' : turn.tone === 'error' ? 'bg-card-coral text-ink' : 'bg-card-lilac text-ink';
  return (
    <li className="grid gap-2">
      <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[15px] text-fg">{item.heard}</p>
      <div className="flex max-w-[92%] items-start gap-3">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${badge}`}>
          <Icon size={15} strokeWidth={2.6} aria-hidden />
        </span>
        <div className="grid gap-2">
          <p className="text-[15px] font-medium leading-snug">{turn.say}</p>
          {latest && turn.options && (
            <div className="flex flex-wrap gap-2">
              {turn.options.map((label) => (
                <button key={label} type="button" onClick={() => onPick(label)} className="rounded-full border border-line px-3.5 py-1.5 text-sm font-medium hover:bg-surface-2">
                  {label}
                </button>
              ))}
            </div>
          )}
          {latest && turn.undo && (
            <button type="button" onClick={onUndo} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-medium hover:brightness-95">
              <Undo2 size={14} /> Undo
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function VoiceBody({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const session = useVoiceSession(profile, onClose);
  const [typed, setTyped] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const { log } = session;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [log.length, session.phase]);

  const submit = (text: string) => {
    const value = text.trim();
    if (!value) return;
    setTyped('');
    void session.send(value);
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <Orb phase={session.phase} handsFree={session.handsFree} supported={session.supported} onClick={session.toggle} />
        <p role="status" aria-live="polite" className="text-base font-semibold">
          {!session.supported ? 'Voice isn’t available here' : session.phase === 'idle' && !session.handsFree ? 'Paused · tap to talk' : STATUS[session.phase]}
        </p>
        <p className="min-h-6 max-w-sm px-2 text-[15px] italic text-muted" aria-hidden={!session.heard}>
          {session.heard ? `“${session.heard}”` : ''}
        </p>
      </div>

      {!session.supported && (
        <p role="alert" className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">
          This browser can’t listen for speech. Chrome, Edge and Safari work best. You can still type commands below.
        </p>
      )}
      {session.error && (
        <p role="alert" className="tint rounded-2xl bg-card-coral p-3 text-sm font-medium text-ink">
          {session.error}
        </p>
      )}

      {log.length > 0 ? (
        <div className="max-h-[34dvh] overflow-y-auto pr-1" tabIndex={0} role="region" aria-label="Conversation">
          <ul className="grid gap-4">
            {log.map((item, i) => (
              <Reply key={item.id} item={item} latest={i === log.length - 1} onUndo={() => submit('undo')} onPick={(label) => submit(label)} />
            ))}
          </ul>
          <div ref={bottom} />
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted">Try saying</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-line px-3.5 py-2 text-sm font-medium hover:bg-surface-2">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(typed);
        }}
        className="flex items-center gap-2 border-t border-line pt-4"
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
          className="h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-[15px] text-fg placeholder:text-muted focus:border-fg/30 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!typed.trim() || session.phase === 'thinking'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fg text-app transition disabled:opacity-40 dark:bg-card-lime dark:text-ink"
        >
          <Send size={18} />
        </button>
        {session.canSpeak && (
          <button
            type="button"
            onClick={() => session.setReplies(!session.replies)}
            aria-pressed={session.replies}
            aria-label={session.replies ? 'Turn spoken answers off' : 'Turn spoken answers on'}
            title={session.replies ? 'Spoken answers on' : 'Spoken answers off'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg hover:brightness-95"
          >
            {session.replies ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        )}
      </form>
    </div>
  );
}

/** Hands-free assistant: talk, and tasks are added, moved or removed straight away. */
export function VoiceAgent({ profile }: { profile: Profile }) {
  const open = useUi((s) => s.voiceOpen);
  const close = useUi((s) => s.closeVoice);
  return (
    <Sheet open={open} onClose={close} title="Talk to Dayflow">
      <VoiceBody profile={profile} onClose={close} />
    </Sheet>
  );
}
