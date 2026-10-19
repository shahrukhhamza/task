import { Check, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AI_ERROR_TEXT, AiError } from '../../../supabase/functions/_shared/gemini.ts';
import { breakDown, type Step } from '../../lib/ai/assistant';
import { addParsedTasks, deleteTask } from '../../lib/db/actions';
import { formatDuration } from '../../lib/time/tz';
import type { Task } from '../../lib/types';
import { useUi } from '../../store/ui';

/** Gemini splits a big task into steps; the chosen steps replace it (one undo brings it back). */
export function BreakDown({ task, onDone }: { task: Task; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await breakDown(task);
      setSteps(result);
      setChosen(new Set(result.map((_, i) => i)));
    } catch (err) {
      setError(err instanceof AiError ? AI_ERROR_TEXT[err.code] : 'Couldn’t break this down right now.');
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!steps) return;
    const picked = steps.filter((_, i) => chosen.has(i));
    const { undo: undoAdd } = await addParsedTasks(
      picked.map((s) => ({ raw: s.title, title: s.title, durationMin: s.durationMin, category: task.category, priority: task.priority, dueAt: task.dueAt })),
    );
    const undoDelete = await deleteTask(task.id);
    onDone();
    toast(`Split into ${picked.length} steps.`, {
      undo: async () => {
        await undoAdd();
        await undoDelete();
      },
    });
  };

  if (!steps) {
    return (
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => void ask()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card-lilac px-3.5 text-sm font-semibold text-ink disabled:opacity-70"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {loading ? 'Thinking…' : 'Break it down'}
        </button>
        {error && <p className="mt-2 text-sm text-muted">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-[22px] bg-card-lilac p-4 text-ink">
      <p className="flex items-center gap-2 font-bold">
        <Sparkles size={16} /> Suggested steps
      </p>
      <ul className="grid gap-1.5">
        {steps.map((s, i) => {
          const on = chosen.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => {
                  const next = new Set(chosen);
                  if (on) next.delete(i);
                  else next.add(i);
                  setChosen(next);
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-white/60 px-3 py-2.5 text-left"
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink ${on ? 'bg-ink text-white' : ''}`}>
                  {on && <Check size={13} strokeWidth={3} />}
                </span>
                <span className="flex-1 font-semibold">{s.title}</span>
                <span className="text-sm font-semibold opacity-70">{formatDuration(s.durationMin)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setSteps(null)} className="rounded-full px-4 py-2 text-sm font-semibold">
          Cancel
        </button>
        <button type="button" disabled={!chosen.size} onClick={() => void apply()} className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          Use {chosen.size} {chosen.size === 1 ? 'step' : 'steps'}
        </button>
      </div>
    </div>
  );
}
