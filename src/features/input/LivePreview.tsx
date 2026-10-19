import { CalendarPlus, Clock, Flag, Repeat, Timer, Wand2 } from 'lucide-react';
import type { ParseResult, ParsedCommand, ParsedTask } from '../../lib/parser';
import { formatDayLabel, formatTime } from '../../lib/time/tz';
import { describeDuration, describeRecurrence, describeWhen } from './describe';

const PRIORITY_LABEL = { high: 'High', med: 'Normal', low: 'Low' } as const;

function describeCommand(c: ParsedCommand, tz: string, now: number): string {
  switch (c.kind) {
    case 'push': {
      const day = formatDayLabel(c.to, tz, now);
      return `Move “${c.target}” to ${day}${c.hasTime ? ` at ${formatTime(c.to, tz)}` : ''}`;
    }
    case 'finish':
      return `Mark “${c.target}” as done`;
    case 'start':
      return `Start “${c.target}”`;
    case 'delete':
      return `Delete “${c.target}”`;
    case 'late':
      return c.minutes ? `You’re ${c.minutes} min behind. Re-plan the day` : 'You’re behind. Re-plan from now';
    case 'next':
      return 'Show what’s next';
    case 'calendar':
      return `Add “${c.target}” to Google Calendar`;
    case 'update': {
      const { change } = c;
      const what: string[] = [];
      if (change.title) what.push(`rename to “${change.title}”`);
      if (change.startMin !== undefined || change.asRange) {
        const start = change.startMin ?? change.asRange?.startMin;
        const clock = (m: number) => `${m % 720 === 0 ? 12 : Math.floor((m % 720) / 60)}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'AM' : 'PM'}`;
        what.push(`${change.endMin !== undefined ? `${clock(start as number)} to ${clock(change.endMin)}` : `start at ${clock(start as number)}`}`);
      }
      if (change.day !== undefined) what.push(formatDayLabel(change.day, tz, now).toLowerCase());
      if (change.durationMin) what.push(`${change.durationMin} min long`);
      if (change.priority) what.push(`${change.priority === 'med' ? 'normal' : change.priority} priority`);
      return `Update ${c.target ? `“${c.target}”` : 'the task'}: ${what.join(', ')}`;
    }
  }
}

const tag = 'inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg';

/** The chips that describe a parsed task: when, how long, priority, repeat, calendar. */
export function TaskSummary({ task, timezone, now }: { task: ParsedTask; timezone: string; now: number }) {
  const when = describeWhen(task, timezone, now);
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={tag}>
        <Clock size={12} /> {when ?? 'Anytime'}
      </span>
      {task.durationMin && task.fixedStart === undefined && (
        <span className={tag}>
          <Timer size={12} /> {describeDuration(task.durationMin)}
        </span>
      )}
      {task.priority && task.priority !== 'med' && (
        <span className={tag}>
          <Flag size={12} /> {PRIORITY_LABEL[task.priority]}
        </span>
      )}
      {task.recurrence && (
        <span className={tag}>
          <Repeat size={12} /> {describeRecurrence(task.recurrence)}
        </span>
      )}
      {task.addToCalendar && (
        <span className={tag}>
          <CalendarPlus size={12} /> Calendar
        </span>
      )}
    </div>
  );
}

/** What Dayflow understood, shown as you type. */
export function LivePreview({ result, timezone, now }: { result: ParseResult; timezone: string; now: number }) {
  if (result.kind === 'empty') return null;

  return (
    <div aria-live="polite" className="grid max-h-56 gap-2 overflow-y-auto">
      {result.kind === 'command' ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
          <Wand2 size={18} className="shrink-0" />
          <span className="text-sm font-medium">{describeCommand(result.command, timezone, now)}</span>
        </div>
      ) : (
        result.tasks.map((t, i) => (
          <div key={i} className="rounded-2xl border border-line p-3">
            <p className="mb-2 font-medium">{t.title}</p>
            <TaskSummary task={t} timezone={timezone} now={now} />
          </div>
        ))
      )}
    </div>
  );
}
