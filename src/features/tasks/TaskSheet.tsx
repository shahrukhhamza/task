import { Check, Clock, Pencil, Play, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { Button, Chip } from '../../components/ui';
import { completeTask, deleteTask, skipTask, updateTask } from '../../lib/db/actions';
import type { ParsedTask } from '../../lib/parser';
import { adjustEstimate, statsFromTasks, type Risk } from '../../lib/scheduler';
import { formatDayLabel, formatDuration, formatTime } from '../../lib/time/tz';
import type { Profile, Task } from '../../lib/types';
import { useUi } from '../../store/ui';
import { describeRecurrence, describeWhen } from '../input/describe';
import { TaskForm } from '../input/TaskForm';
import { CalendarActions } from './CalendarActions';
import { BreakDown } from '../ai/BreakDown';
import { useAiAvailable } from '../../lib/ai/assistant';

const toDraft = (t: Task): ParsedTask => ({
  raw: t.title,
  title: t.title,
  category: t.category,
  priority: t.priority,
  durationMin: t.estimateMin,
  dueAt: t.dueAt,
  fixedStart: t.fixedStart,
  fixedEnd: t.fixedEnd,
  recurrence: t.recurrence,
  addToCalendar: t.addToCalendar,
});

const PRIORITY = { high: 'High priority', med: 'Normal priority', low: 'Low priority' } as const;

interface TaskSheetProps {
  tasks: Task[];
  profile: Profile;
  now: number;
  risks: Risk[];
}

/** Details and actions for one task: the two common actions are big, the rest small. */
export function TaskSheet({ tasks, profile, now, risks }: TaskSheetProps) {
  const selectedId = useUi((s) => s.selectedTaskId);
  const select = useUi((s) => s.select);
  const startFocus = useUi((s) => s.startFocus);
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<ParsedTask | null>(null);
  const ai = useAiAvailable();

  const task = tasks.find((t) => t.id === selectedId);
  const tz = profile.timezone;

  useEffect(() => setEditing(null), [selectedId]);

  const close = () => select(null);
  const run = async (action: () => Promise<() => Promise<void>>, message: string) => {
    const undo = await action();
    close();
    toast(message, { undo });
  };

  const risk = task && risks.find((r) => r.taskId === task.id);
  const learned = task && task.fixedStart === undefined && task.status !== 'done' ? adjustEstimate(task.estimateMin, task.category, statsFromTasks(tasks)) : undefined;
  const when = task && describeWhen(task, tz, now);
  const nextBlock = task?.blocks.slice().sort((a, b) => a.start - b.start).find((b) => b.end > now);

  return (
    <Sheet open={!!task} onClose={close} title={editing ? 'Edit task' : (task?.title ?? 'Task')} bare={!editing}>
      {task && editing && (
        <div className="grid gap-5">
          <TaskForm value={editing} onChange={setEditing} timezone={tz} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!editing.title.trim()}
              onClick={() =>
                run(
                  () =>
                    updateTask(task.id, {
                      title: editing.title.trim(),
                      category: editing.category ?? 'general',
                      priority: editing.priority ?? 'med',
                      estimateMin: editing.durationMin ?? task.estimateMin,
                      dueAt: editing.dueAt,
                      fixedStart: editing.fixedStart,
                      fixedEnd: editing.fixedEnd,
                      recurrence: editing.recurrence,
                      addToCalendar: editing.addToCalendar,
                      blocks: [],
                    }),
                  'Saved.',
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {task && !editing && (
        <div className="grid gap-5">
          <div>
            <h2 className={`text-[28px] font-semibold leading-tight ${task.status === 'done' ? 'text-muted line-through' : ''}`}>{task.title}</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {task.status === 'done' && <Chip tone="teal">Done</Chip>}
              {task.priority !== 'med' && <Chip tone={task.priority === 'high' ? 'red' : 'neutral'}>{PRIORITY[task.priority]}</Chip>}
              {task.fixedStart === undefined && <Chip>{formatDuration(task.estimateMin)}</Chip>}
              {task.category !== 'general' && <Chip>{task.category}</Chip>}
              {task.recurrence && <Chip tone="violet">{describeRecurrence(task.recurrence)}</Chip>}
              {task.spentMin > 0 && <Chip tone="amber">{formatDuration(task.spentMin)} focused</Chip>}
            </div>
          </div>

          {(when || nextBlock) && (
            <div className="grid gap-1 rounded-[20px] bg-surface-2 p-4 text-sm font-medium">
              {when && (
                <p className="flex items-center gap-2">
                  <Clock size={16} className="text-muted" /> {when}
                </p>
              )}
              {nextBlock && task.fixedStart === undefined && (
                <p className="text-muted">
                  Planned {formatDayLabel(nextBlock.start, tz, now).toLowerCase()}, {formatTime(nextBlock.start, tz)} – {formatTime(nextBlock.end, tz)}
                  {task.blocks.length > 1 ? ` (+${task.blocks.length - 1} more)` : ''}
                </p>
              )}
            </div>
          )}

          {risk && <p className="tint rounded-[20px] bg-card-sun p-4 text-sm font-medium text-ink">{risk.message}</p>}
          {learned !== undefined && learned !== task.estimateMin && (
            <p className="tint rounded-[20px] bg-card-lilac p-4 text-sm font-medium text-ink">
              Planned as {formatDuration(learned)}: your {task.category} tasks usually take {learned > task.estimateMin ? 'longer' : 'less'} than you estimate.
            </p>
          )}

          {task.status === 'done' ? (
            <Button size="lg" onClick={() => run(() => updateTask(task.id, { status: 'todo', completedAt: undefined }), 'Reopened.')}>
              <RotateCcw size={18} /> Not done yet
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {task.fixedStart === undefined ? (
                <button type="button" onClick={() => startFocus(task.id)} className="flex h-14 items-center justify-center gap-2 rounded-full bg-card-lime font-semibold text-ink">
                  <Play size={18} fill="currentColor" /> Start focus
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => run(() => completeTask(task.id), `Done: “${task.title}”. Nice.`)}
                className={`flex h-14 items-center justify-center gap-2 rounded-full bg-fg font-semibold text-app ${task.fixedStart !== undefined ? 'col-span-2 dark:bg-card-lime dark:text-ink' : 'dark:bg-surface-2 dark:text-fg dark:ring-1 dark:ring-line'}`}
              >
                <Check size={18} strokeWidth={3} /> Done
              </button>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-2">
            {task.status !== 'done' && (
              <Button size="sm" onClick={() => run(() => skipTask(task.id), task.fixedStart === undefined ? 'Moved to tomorrow.' : 'Skipped.')}>
                <SkipForward size={15} /> {task.fixedStart === undefined ? 'Tomorrow' : 'Skip'}
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing(toDraft(task))}>
              <Pencil size={15} /> Edit
            </Button>
            <Button size="sm" onClick={() => run(() => deleteTask(task.id), `Deleted “${task.title}”.`)}>
              <Trash2 size={15} /> Delete
            </Button>
          </div>

          {ai && task.status !== 'done' && task.fixedStart === undefined && task.estimateMin >= 30 && (
            <BreakDown key={task.id} task={task} onDone={close} />
          )}

          <CalendarActions task={task} timezone={tz} />
        </div>
      )}
    </Sheet>
  );
}
