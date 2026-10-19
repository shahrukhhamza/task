import { ArrowLeft, Loader2, Mic, MicOff, Pencil, Sparkles, Square, Trash2 } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { Button } from '../../components/ui';
import { AI_ERROR_TEXT, AiError } from '../../../supabase/functions/_shared/gemini.ts';
import { understand, useAiAvailable } from '../../lib/ai/assistant';
import { runCommand, type CommandOutcome } from '../../lib/commandRunner';
import { addParsedTasks } from '../../lib/db/actions';
import { addHabit } from '../../lib/db/habitActions';
import { db } from '../../lib/db/schema';
import { describeDays, parseHabit } from '../../lib/habits';
import { parseInput, parseTasksOnly, type ParsedTask } from '../../lib/parser';
import { useSpeechRecognition } from '../../lib/speech/useSpeechRecognition';
import type { Profile } from '../../lib/types';
import { useUi } from '../../store/ui';
import { LivePreview, TaskSummary } from './LivePreview';
import { TaskForm } from './TaskForm';

const EXAMPLES = ['Gym at 6pm, call mom', 'Physics assignment due Thursday, 2 hours', 'Dentist Friday 4pm', 'I’m running 30 minutes late'];

type Pending =
  | { kind: 'clarify'; question: string; options: Extract<CommandOutcome, { kind: 'clarify' }>['options'] }
  | { kind: 'notFound'; message: string; raw: string }
  | { kind: 'reply'; text: string };

/**
 * The one place to add anything. Typed and spoken input share a pipeline:
 * input -> transcript -> parser -> editable cards -> planner.
 */
export function AddSheet({ profile, now }: { profile: Profile; now: number }) {
  const open = useUi((s) => s.addOpen);
  const initial = useUi((s) => s.addText);
  const close = useUi((s) => s.closeAdd);
  const toast = useUi((s) => s.toast);

  const [text, setText] = useState('');
  const [step, setStep] = useState<'write' | 'review'>('write');
  const [drafts, setDrafts] = useState<ParsedTask[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [byAi, setByAi] = useState(false);
  const ai = useAiAvailable();
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setText(initial);
    setStep('write');
    setDrafts([]);
    setPending(null);
    setEditing(null);
    setByAi(false);
    setTimeout(() => textarea.current?.focus(), 50);
  }, [open, initial]);

  const speech = useSpeechRecognition(profile.voiceLang, (phrase) => {
    if (phrase) setText((prev) => (prev.trim() ? `${prev.trim().replace(/[,.;]$/, '')}, ${phrase}` : phrase));
  });

  const composed = speech.interim ? `${text}${text ? ', ' : ''}${speech.interim}` : text;
  const deferred = useDeferredValue(composed);
  const minute = Math.floor(now / 60_000);
  const preview = useMemo(() => parseInput(deferred, { now: minute * 60_000, timezone: profile.timezone }), [deferred, minute, profile.timezone]);
  const habitPreview = useMemo(() => parseHabit(deferred), [deferred]);

  const finish = (message: string, undo?: () => Promise<void>) => {
    toast(message, { undo });
    close();
  };

  const handleOutcome = (outcome: CommandOutcome, raw: string) => {
    if (outcome.kind === 'done') finish(outcome.message, outcome.undo);
    else if (outcome.kind === 'info') finish(outcome.message);
    else if (outcome.kind === 'clarify') setPending({ kind: 'clarify', question: outcome.question, options: outcome.options });
    else setPending({ kind: 'notFound', message: outcome.message, raw });
  };

  const submit = async () => {
    if (speech.listening) speech.stop();
    const value = composed.trim();
    if (!value || busy) return;

    const ctx = { now: Date.now(), timezone: profile.timezone };
    const habit = parseHabit(value);
    if (habit) {
      const { undo } = await addHabit(habit);
      finish(`New habit: “${habit.title}” (${describeDays(habit.days).toLowerCase()}).`, undo);
      return;
    }

    setBusy(true);
    setPending(null);
    try {
      // Gemini first when it's on; the built-in parser is the instant, offline fallback
      let result: Awaited<ReturnType<typeof understand>> = parseInput(value, ctx);
      let fromAi = false;
      if (ai) {
        try {
          result = await understand(value, ctx, await db.tasks.toArray());
          fromAi = true;
        } catch (err) {
          const reason = err instanceof AiError ? AI_ERROR_TEXT[err.code] : 'Gemini didn’t answer.';
          toast(`${reason} Used the quick parser instead.`);
        }
      }

      if (result.kind === 'tasks') {
        setByAi(fromAi);
        setDrafts(result.tasks);
        setEditing(result.tasks.length === 1 ? 0 : null);
        setStep('review');
      } else if (result.kind === 'command') {
        handleOutcome(await runCommand(result.command), value);
      } else if (result.kind === 'habit') {
        const { undo } = await addHabit({ title: result.habit.title, days: result.habit.days });
        finish(`New habit: “${result.habit.title}” (${describeDays(result.habit.days).toLowerCase()}).`, undo);
      } else if (result.kind === 'reply') {
        setPending({ kind: 'reply', text: result.text });
      } else {
        toast('I couldn’t find a task in that. Try “Call mom tomorrow at 5pm”.', { tone: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const valid = drafts.filter((t) => t.title.trim());
    if (!valid.length) return;
    setBusy(true);
    try {
      const { tasks, undo } = await addParsedTasks(valid);
      finish(tasks.length === 1 ? `Added “${tasks[0].title}”.` : `Added ${tasks.length} tasks.`, undo);
    } finally {
      setBusy(false);
    }
  };

  const valid = drafts.filter((t) => t.title.trim()).length;

  return (
    <Sheet open={open} onClose={close} title={step === 'review' ? 'Check before adding' : 'Add to your day'} wide={step === 'review'}>
      {step === 'write' ? (
        <div className="grid gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="rounded-[24px] bg-surface-2 p-4 ring-fg/20 transition focus-within:ring-2"
          >
            <label htmlFor="smart-input" className="sr-only">
              Add tasks or give a command
            </label>
            <textarea
              id="smart-input"
              ref={textarea}
              rows={3}
              value={speech.interim ? composed : text}
              readOnly={!!speech.interim}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={speech.listening ? 'Listening… say your tasks' : 'What’s on your mind?'}
              className="w-full resize-none bg-transparent text-xl font-semibold leading-snug text-fg placeholder:text-muted focus:outline-none focus-visible:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={speech.listening ? speech.stop : speech.start}
                disabled={!speech.supported}
                aria-pressed={speech.listening}
                aria-label={speech.listening ? 'Stop listening' : 'Speak your tasks'}
                title={speech.supported ? 'Speak your tasks' : 'Voice isn’t supported in this browser. Chrome or Edge work best.'}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-40 ${
                  speech.listening ? 'mic-live bg-red-600 text-white' : 'bg-ink text-white hover:bg-black'
                }`}
              >
                {!speech.supported ? <MicOff size={20} /> : speech.listening ? <Square size={16} fill="currentColor" /> : <Mic size={20} />}
              </button>
              <span className="text-sm text-muted">{speech.listening ? 'Listening… tap to stop' : speech.supported ? 'Tap to speak' : 'Typing only in this browser'}</span>
              <Button type="submit" variant="primary" className="ml-auto min-w-24" disabled={!composed.trim() || busy}>
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> {ai ? 'Thinking' : 'Adding'}
                  </>
                ) : (
                  'Add'
                )}
              </Button>
            </div>
          </form>

          {speech.error && (
            <p role="alert" className="rounded-2xl bg-card-coral p-3 text-sm font-semibold text-ink">
              {speech.error}
            </p>
          )}

          {pending?.kind === 'reply' && (
            <div role="status" className="flex gap-3 rounded-2xl bg-card-lilac p-4 text-ink">
              <Sparkles size={18} className="mt-0.5 shrink-0" />
              <p className="font-semibold">{pending.text}</p>
            </div>
          )}

          {pending?.kind === 'clarify' && (
            <div role="alert" className="grid gap-2 rounded-2xl bg-card-sun p-4 text-ink">
              <p className="font-bold">{pending.question}</p>
              <div className="flex flex-wrap gap-2">
                {pending.options.map((o) => (
                  <button key={o.label} type="button" className="rounded-full bg-white px-4 py-2 text-sm font-semibold" onClick={async () => handleOutcome(await o.run(), text)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {pending?.kind === 'notFound' && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-card-sun p-4 text-ink">
              <p className="flex-1 font-semibold">{pending.message}</p>
              <button
                type="button"
                className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  const result = parseTasksOnly(pending.raw, { now: Date.now(), timezone: profile.timezone });
                  setPending(null);
                  if (result.kind === 'tasks') {
                    setDrafts(result.tasks);
                    setEditing(result.tasks.length === 1 ? 0 : null);
                    setStep('review');
                  }
                }}
              >
                Add it as a new task
              </button>
            </div>
          )}

          {habitPreview ? (
            <div aria-live="polite" className="rounded-2xl bg-card-lime p-3 text-ink">
              <p className="font-bold">New habit: {habitPreview.title}</p>
              <p className="text-sm font-semibold opacity-70">{describeDays(habitPreview.days)}</p>
            </div>
          ) : (
            <LivePreview result={preview} timezone={profile.timezone} now={now} />
          )}

          {!composed.trim() && (
            <div>
              <p className="mb-2 text-sm font-semibold text-muted">Try</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setText(example);
                      textarea.current?.focus();
                    }}
                    className="rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold hover:brightness-95"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                {ai ? (
                  <>
                    <Sparkles size={13} /> Gemini is on: write or speak naturally, in any language.
                  </>
                ) : (
                  'Add several things at once with commas. Start with “habit:” to build a habit.'
                )}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {byAi && (
            <p className="flex items-center gap-2 text-sm font-semibold text-muted">
              <Sparkles size={15} /> Understood by Gemini. Check the details, then add.
            </p>
          )}
          {drafts.map((task, i) =>
            editing === i ? (
              <div key={i} className="rounded-[24px] bg-surface-2 p-4 ring-fg/20 transition focus-within:ring-2">
                <TaskForm value={task} timezone={profile.timezone} onChange={(next) => setDrafts(drafts.map((t, j) => (j === i ? next : t)))} />
                {drafts.length > 1 && (
                  <div className="mt-4 flex justify-end">
                    <Button size="sm" onClick={() => setEditing(null)}>
                      Done
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div key={i} className="flex items-start gap-3 rounded-[24px] bg-card-cream p-4 text-ink">
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 truncate text-lg font-bold">{task.title || 'Untitled'}</p>
                  <TaskSummary task={task} timezone={profile.timezone} now={now} />
                </div>
                <button type="button" aria-label={`Edit ${task.title}`} onClick={() => setEditing(i)} className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-white">
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${task.title}`}
                  onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ),
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep('write')}>
              <ArrowLeft size={16} /> Back
            </Button>
            <Button variant="primary" size="lg" disabled={!valid || busy} onClick={() => void confirm()}>
              Add {valid > 1 ? `${valid} tasks` : 'to my day'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
