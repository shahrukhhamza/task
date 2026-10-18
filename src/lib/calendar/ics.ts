import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';
import type { Task } from '../types';
import { eventDescription, eventTiming, eventTitle, recurrenceToRrule } from './event';

/** RFC 5545 text escaping. */
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded with CRLF + space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (size + len > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  out.push(current);
  return out.join('\r\n ');
}

const utc = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function vevent(task: Task, tz: string, now: number): string[] | null {
  const timing = eventTiming(task);
  if (!timing) return null;
  const lines = ['BEGIN:VEVENT', `UID:${task.id}@dayflow`, `DTSTAMP:${utc(now)}`];

  if (timing.allDay) {
    const day = new TZDate(timing.start, tz);
    lines.push(`DTSTART;VALUE=DATE:${format(day, 'yyyyMMdd')}`, `DTEND;VALUE=DATE:${format(addDays(day, 1), 'yyyyMMdd')}`);
  } else if (task.recurrence) {
    // repeating events use local time so "every Monday" stays Monday in the user's zone
    lines.push(
      `DTSTART;TZID=${tz}:${format(new TZDate(timing.start, tz), "yyyyMMdd'T'HHmmss")}`,
      `DTEND;TZID=${tz}:${format(new TZDate(timing.end, tz), "yyyyMMdd'T'HHmmss")}`,
    );
  } else {
    lines.push(`DTSTART:${utc(timing.start)}`, `DTEND:${utc(timing.end)}`);
  }

  lines.push(`SUMMARY:${escape(eventTitle(task, timing))}`, `DESCRIPTION:${escape(eventDescription(task))}`);
  if (task.recurrence) lines.push(recurrenceToRrule(task.recurrence));
  lines.push('END:VEVENT');
  return lines;
}

/** A complete .ics file for one or more tasks. Tasks with nothing to schedule are left out. */
export function buildIcs(tasks: Task[], tz: string, now = Date.now()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dayflow//Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const task of tasks) {
    const event = vevent(task, tz, now);
    if (event) lines.push(...event);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
