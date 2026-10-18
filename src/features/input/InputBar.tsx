import { ArrowUp, Mic, MicOff, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui';
import { runCommand, type CommandOutcome } from '../../lib/commandRunner';
import { addParsedTasks, updateProfile } from '../../lib/db/actions';
import { addHabit } from '../../lib/db/habitActions';
import { describeDays, parseHabit } from '../../lib/habits';
import { parseInput, parseTasksOnly, type ParsedTask } from '../../lib/parser';
import { useSpeechRecognition, VOICE_LANGUAGES } from '../../lib/speech/useSpeechRecognition';
import type { Profile } from '../../lib/types';
import { useUi } from '../../store/ui';
import { LivePreview } from './LivePreview';
import { ReviewSheet } from './ReviewSheet';

type Pending =
  | { kind: 'clarify'; question: string; options: Extract<CommandOutcome, { kind: 'clarify' }>['options'] }
  | { kind: 'notFound'; message: string; raw: string };

/** Text and voice share one pipeline: input -> transcript -> parser -> editable cards -> planner. */
export function InputBar({ profile, now }: { profile: Profile; now: number }) {
  const [text, setText] = useState('');
  const [review, setReview] = useState<ParsedTask[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const toast = useUi((s) => s.toast);
  const focusTick = useUi((s) => s.inputFocusTick);

  const speech = useSpeechRecognition(profile.voiceLang, (phrase) => {
    if (phrase) setText((prev) => (prev.trim() ? `${prev.trim().replace(/[,.;]$/, '')}, ${phrase}` : phrase));
  });

  const draft = useUi((s) => s.draft);
  useEffect(() => {
    if (draft.tick > 0) setText(draft.text);
  }, [draft]);

  useEffect(() => {
    if (focusTick > 0) textarea.current?.focus();
  }, [focusTick]);

  // grow with content, up to about five lines
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [text, speech.interim]);

  const composed = speech.interim ? `${text}${text ? ', ' : ''}${speech.interim}` : text;
  const deferred = useDeferredValue(composed);
  const minute = Math.floor(now / 60_000);
  const preview = useMemo(
    () => parseInput(deferred, { now: minute * 60_000, timezone: profile.timezone }),
    [deferred, minute, profile.timezone],
  );

  const habitPreview = useMemo(() => parseHabit(deferred), [deferred]);

  const handleOutcome = (outcome: CommandOutcome, raw: string) => {
    if (outcome.kind === 'done') {
      toast(outcome.message, { undo: outcome.undo });
      setText('');
      setPending(null);
    } else if (outcome.kind === 'info') {
      toast(outcome.message);
      setText('');
      setPending(null);
    } else if (outcome.kind === 'clarify') {
      setPending({ kind: 'clarify', question: outcome.question, options: outcome.options });
    } else {
      setPending({ kind: 'notFound', message: outcome.message, raw });
    }
  };

  const submit = async () => {
    if (speech.listening) speech.stop();
    const value = composed.trim();
    if (!value) return;

    const habit = parseHabit(value);
    if (habit) {
      const { undo } = await addHabit(habit);
      toast(`New habit: “${habit.title}” (${describeDays(habit.days).toLowerCase()}).`, { undo });
      setText('');
      return;
    }

    const result = parseInput(value, { now: Date.now(), timezone: profile.timezone });

    if (result.kind === 'tasks') {
      setReview(result.tasks);
    } else if (result.kind === 'command') {
      handleOutcome(await runCommand(result.command), value);
    } else {
      toast('I couldn’t find a task in that. Try “Call mom tomorrow at 5pm”.', { tone: 'error' });
    }
  };

  const confirmTasks = async (tasks: ParsedTask[]) => {
    setReview(null);
    const { tasks: created, undo } = await addParsedTasks(tasks);
    setText('');
    setPending(null);
    toast(created.length === 1 ? `Added “${created[0].title}”.` : `Added ${created.length} tasks.`, { undo });
  };

  const addAsTask = (raw: string) => {
    const result = parseTasksOnly(raw, { now: Date.now(), timezone: profile.timezone });
    setPending(null);
    if (result.kind === 'tasks') setReview(result.tasks);
  };

  const nonEnglish = !profile.voiceLang.startsWith('en');

  return (
    <section aria-label="Add tasks or give a command" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto max-w-3xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {pending?.kind === 'clarify' && (
          <div role="alert" className="mb-2 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="font-medium">{pending.question}</p>
              <button type="button" aria-label="Cancel" onClick={() => setPending(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {pending.options.map((o) => (
                <Button key={o.label} size="sm" onClick={async () => handleOutcome(await o.run(), text)}>
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        )}
        {pending?.kind === 'notFound' && (
          <div role="alert" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
            <span className="flex-1">{pending.message}</span>
            <Button size="sm" onClick={() => addAsTask(pending.raw)}>
              Add as new task
            </Button>
            <button type="button" aria-label="Dismiss" onClick={() => setPending(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {speech.error && (
          <p role="alert" className="mb-2 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-100">
            {speech.error}
          </p>
        )}

        {habitPreview ? (
          <p aria-live="polite" className="mb-2 rounded-xl bg-slate-100 p-2.5 text-sm dark:bg-slate-800/80">
            New habit: <strong>{habitPreview.title}</strong> · {describeDays(habitPreview.days)}
          </p>
        ) : (
          <LivePreview result={preview} timezone={profile.timezone} now={now} />
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="relative flex-1">
            <label htmlFor="smart-input" className="sr-only">
              Add tasks or give a command
            </label>
            <textarea
              id="smart-input"
              ref={textarea}
              rows={1}
              value={speech.interim ? composed : text}
              readOnly={!!speech.interim}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape') (e.target as HTMLElement).blur();
              }}
              placeholder={speech.listening ? 'Listening… speak your tasks' : 'Gym at 6pm, call mom, physics due Thursday ~2h !high'}
              className="max-h-32 w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            />
          </div>

          <button
            type="button"
            onClick={speech.listening ? speech.stop : speech.start}
            disabled={!speech.supported}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? 'Stop listening' : 'Speak your tasks'}
            title={speech.supported ? 'Speak your tasks' : 'Voice input isn’t supported in this browser. Chrome or Edge work best.'}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              speech.listening
                ? 'mic-live bg-red-600 text-white'
                : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {speech.supported ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          <button
            type="submit"
            disabled={!composed.trim()}
            aria-label="Add"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp size={20} />
          </button>
        </form>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
          <span>
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">/</kbd> or{' '}
            <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">Ctrl K</kbd> to focus · tags{' '}
            <code>#cat !high ~2h @fri</code>
          </span>
          {!speech.supported ? (
            <span>Voice isn’t available here. Typing works everywhere.</span>
          ) : (
            <label className="inline-flex items-center gap-1.5">
              Voice
              <select
                value={profile.voiceLang}
                onChange={(e) => void updateProfile({ voiceLang: e.target.value })}
                className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                aria-label="Voice language"
              >
                {VOICE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {nonEnglish && speech.supported && (
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Speech will be transcribed in this language, but understanding dates and commands works in English only for now.
          </p>
        )}
      </div>

      <ReviewSheet tasks={review} timezone={profile.timezone} onConfirm={confirmTasks} onCancel={() => setReview(null)} />
    </section>
  );
}
