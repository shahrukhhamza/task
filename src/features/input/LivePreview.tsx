import { CalendarPlus, Clock, Flag, Repeat, Tag, Timer } from 'lucide-react';
import { Chip } from '../../components/ui';
import type { ParseResult, ParsedCommand } from '../../lib/parser';
import { formatDayLabel, formatTime } from '../../lib/time/tz';
import { describeDuration, describeRecurrence, describeWhen } from './describe';

const PRIORITY_LABEL = { high: 'High priority', med: 'Medium priority', low: 'Low priority' } as const;

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
      return c.minutes ? `You’re ${c.minutes} min behind: re-plan the day` : 'You’re behind: re-plan from now';
    case 'next':
      return 'Show what’s next';
    case 'calendar':
      return `Add “${c.target}” to Google Calendar`;
  }
}

export function LivePreview({ result, timezone, now }: { result: ParseResult; timezone: string; now: number }) {
  if (result.kind === 'empty') return null;

  return (
    <div aria-live="polite" className="mb-2 max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-slate-100 p-2.5 text-sm dark:bg-slate-800/80">
      {result.kind === 'command' ? (
        <div className="flex items-center gap-2">
          <Chip tone="violet">Command</Chip>
          <span>{describeCommand(result.command, timezone, now)}</span>
        </div>
      ) : (
        result.tasks.map((t, i) => {
          const when = describeWhen(t, timezone, now);
          return (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 font-semibold">{t.title}</span>
              {when && (
                <Chip tone="teal">
                  <Clock size={12} /> {when}
                </Chip>
              )}
              {t.durationMin && (
                <Chip>
                  <Timer size={12} /> {describeDuration(t.durationMin)}
                </Chip>
              )}
              {t.priority && (
                <Chip tone={t.priority === 'high' ? 'red' : t.priority === 'low' ? 'neutral' : 'amber'}>
                  <Flag size={12} /> {PRIORITY_LABEL[t.priority]}
                </Chip>
              )}
              {t.category && (
                <Chip>
                  <Tag size={12} /> {t.category}
                </Chip>
              )}
              {t.recurrence && (
                <Chip tone="violet">
                  <Repeat size={12} /> {describeRecurrence(t.recurrence)}
                </Chip>
              )}
              {t.addToCalendar && (
                <Chip tone="teal">
                  <CalendarPlus size={12} /> Calendar
                </Chip>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
