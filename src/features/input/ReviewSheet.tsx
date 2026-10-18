import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { Button } from '../../components/ui';
import type { ParsedTask } from '../../lib/parser';
import { TaskForm } from './TaskForm';

interface ReviewSheetProps {
  tasks: ParsedTask[] | null;
  timezone: string;
  onConfirm: (tasks: ParsedTask[]) => void;
  onCancel: () => void;
}

/** Last chance to fix misheard words or wrong dates before tasks are planned. */
export function ReviewSheet({ tasks, timezone, onConfirm, onCancel }: ReviewSheetProps) {
  const [draft, setDraft] = useState<ParsedTask[]>([]);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (tasks) setDraft(tasks);
  }, [tasks]);

  useEffect(() => {
    if (tasks) confirmRef.current?.focus();
  }, [tasks]);

  const valid = draft.filter((t) => t.title.trim());

  return (
    <Sheet open={!!tasks} onClose={onCancel} title={draft.length === 1 ? 'Check this task' : `Check ${draft.length} tasks`} wide>
      <div className="grid gap-4">
        {draft.map((task, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            {draft.length > 1 && (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Task {i + 1}</span>
                <button
                  type="button"
                  aria-label={`Remove task ${i + 1}`}
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                  className="rounded-md p-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
            <TaskForm value={task} timezone={timezone} onChange={(next) => setDraft(draft.map((t, j) => (j === i ? next : t)))} />
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button ref={confirmRef} variant="primary" disabled={valid.length === 0} onClick={() => onConfirm(valid)}>
          Add {valid.length > 1 ? `${valid.length} tasks` : 'task'} to my day
        </Button>
      </div>
    </Sheet>
  );
}
