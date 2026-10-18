import { CheckCircle2, Clock, Pencil, RotateCcw, SkipForward, Timer, Trash2 } from 'lucide-react';
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

interface TaskSheetProps {
  tasks: Task[];
  profile: Profile;
  now: number;
  risks: Risk[];
}

/** Details and actions for one task, opened by tapping a block anywhere in the app. */
export function TaskSheet({ tasks, profile, now, risks }: TaskSheetProps) {
  const selectedId = useUi((s) => s.selectedTaskId);
  const select = useUi((s) => s.select);
  const startFocus = useUi((s) => s.startFocus);
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<ParsedTask | null>(null);

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

  return (
    <Sheet open={!!task} onClose={close} title={editing ? 'Edit task' : (task?.title ?? '')}>
      {task && editing && (
        <div className="grid gap-4">
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
                  'Task updated.',
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {task && !editing && (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="teal">{task.category}</Chip>
            <Chip tone={task.priority === 'high' ? 'red' : task.priority === 'low' ? 'neutral' : 'amber'}>
              {task.priority === 'med' ? 'medium' : task.priority} priority
            </Chip>
            {task.fixedStart === undefined && <Chip>~{formatDuration(task.estimateMin)}</Chip>}
            {task.spentMin > 0 && <Chip tone="violet">{formatDuration(task.spentMin)} focused</Chip>}
            {task.recurrence && <Chip tone="violet">{describeRecurrence(task.recurrence)}</Chip>}
            {task.status === 'done' && <Chip tone="teal">Done</Chip>}
          </div>

          <dl className="grid gap-2 text-sm">
            {when && (
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-slate-500" />
                <dt className="sr-only">When</dt>
                <dd>{when}</dd>
              </div>
            )}
            {task.blocks.length > 0 && (
              <div>
                <dt className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Planned</dt>
                <dd className="grid gap-0.5">
                  {task.blocks.map((b) => (
                    <span key={b.id}>
                      {formatDayLabel(b.start, tz, now)} · {formatTime(b.start, tz)} – {formatTime(b.end, tz)}
                      {b.chunks > 1 && <span className="text-slate-600 dark:text-slate-400"> (part {b.chunk} of {b.chunks})</span>}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {learned !== undefined && task && learned !== task.estimateMin && (
            <p className="rounded-xl bg-violet-50 p-3 text-sm text-violet-950 dark:bg-violet-900/25 dark:text-violet-100">
              Dayflow plans {formatDuration(learned)} for this. You estimated {formatDuration(task.estimateMin)}, but your {task.category} tasks
              usually take {learned > task.estimateMin ? 'longer' : 'less time'} than planned.
            </p>
          )}

          {risk && (
            <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-900/25 dark:text-amber-100">
              {risk.message}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {task.status === 'done' ? (
              <Button
                onClick={() =>
                  run(() => updateTask(task.id, { status: 'todo', completedAt: undefined }), 'Reopened.')
                }
              >
                <RotateCcw size={16} /> Reopen
              </Button>
            ) : (
              <>
                {task.fixedStart === undefined && (
                  <Button variant="primary" onClick={() => startFocus(task.id)}>
                    <Timer size={16} /> Focus timer
                  </Button>
                )}
                <Button onClick={() => run(() => completeTask(task.id), `Done: “${task.title}”.`)}>
                  <CheckCircle2 size={16} /> Mark done
                </Button>
                <Button onClick={() => run(() => skipTask(task.id), task.fixedStart === undefined ? 'Moved to tomorrow.' : 'Skipped.')}>
                  <SkipForward size={16} /> {task.fixedStart === undefined ? 'Skip to tomorrow' : 'Skip'}
                </Button>
              </>
            )}
            <Button onClick={() => setEditing(toDraft(task))}>
              <Pencil size={16} /> Edit
            </Button>
            <Button variant="ghost" className="col-span-2 !text-red-700 dark:!text-red-300" onClick={() => run(() => deleteTask(task.id), `Deleted “${task.title}”.`)}>
              <Trash2 size={16} /> Delete
            </Button>
          </div>

          <CalendarActions task={task} timezone={tz} />
        </div>
      )}
    </Sheet>
  );
}
