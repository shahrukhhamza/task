import { CheckCircle2, Flag, TriangleAlert } from 'lucide-react';
import { Button, Card, Chip } from '../../components/ui';
import { applySuggestion } from '../../lib/db/actions';
import type { Risk } from '../../lib/scheduler';
import { DAY, formatDayLabel, formatTime } from '../../lib/time/tz';
import type { Block, Task } from '../../lib/types';
import { useUi } from '../../store/ui';

interface Props {
  tasks: Task[];
  blocks: Block[];
  risks: Risk[];
  now: number;
  tz: string;
}

/** Every upcoming deadline, with how the current plan stacks up against it. */
export function DeadlineRiskPanel({ tasks, blocks, risks, now, tz }: Props) {
  const toast = useUi((s) => s.toast);
  const select = useUi((s) => s.select);

  const withDeadline = tasks
    .filter((t) => ['todo', 'scheduled', 'doing'].includes(t.status) && t.dueAt !== undefined && t.dueAt < now + 21 * DAY)
    .sort((a, b) => (a.dueAt as number) - (b.dueAt as number));

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Flag size={16} /> Deadlines
      </h2>
      {withDeadline.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No deadlines in the next three weeks. Add one like “report due Friday”.</p>
      ) : (
        <ul className="grid gap-3">
          {withDeadline.map((task) => {
            const risk = risks.find((r) => r.taskId === task.id);
            const finish = blocks.filter((b) => b.taskId === task.id).reduce((latest, b) => Math.max(latest, b.end), 0);
            const status = risk?.kind === 'overdue' ? 'Overdue' : risk ? 'At risk' : 'On track';
            const tone = risk?.kind === 'overdue' ? 'red' : risk ? 'amber' : 'teal';
            const endOfDay = (task.dueAt as number) % 60_000 === 59_999;
            return (
              <li key={task.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => select(task.id)} className="text-left font-medium hover:underline">
                    {task.title}
                  </button>
                  <Chip tone={tone}>
                    {risk ? <TriangleAlert size={12} /> : <CheckCircle2 size={12} />} {status}
                  </Chip>
                </div>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                  Due {formatDayLabel(task.dueAt as number, tz, now)}
                  {endOfDay ? '' : ` at ${formatTime(task.dueAt as number, tz)}`}
                  {!risk && finish > 0 && <> · planned to finish {formatDayLabel(finish, tz, now).toLowerCase()} {formatTime(finish, tz)}</>}
                </p>
                {risk && (
                  <div className="mt-2 grid gap-2 text-sm">
                    <p className="text-amber-900 dark:text-amber-200">{risk.message}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {risk.suggestions.map((s, i) =>
                        s.taskId && s.action !== 'extend' ? (
                          <Button
                            key={i}
                            size="sm"
                            onClick={async () => {
                              const undo = await applySuggestion(s.taskId as string, s.action as 'move' | 'drop', s.startAfter);
                              toast('Plan updated.', { undo });
                            }}
                          >
                            {s.text}
                          </Button>
                        ) : (
                          <span key={i} className="text-slate-700 dark:text-slate-300">
                            {s.text}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
