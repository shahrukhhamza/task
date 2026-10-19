import type { TaskChange } from './parser';
import { addDaysTz, atMinutesOfDay, endOfDayTz, formatDayLabel, formatDuration, formatTime, MIN, minutesOfDay, startOfDayTz } from './time/tz';
import type { Task } from './types';

export interface AppliedChange {
  changes: Partial<Task>;
  /** True when the task's time moved, so the history records a reschedule. */
  rescheduled: boolean;
  /** One plain sentence for the user, e.g. `Updated "Meeting": today from 7:00 PM to 7:30 PM.` */
  message: string;
}

const DAY = 24 * 60 * MIN;
const quote = (title: string) => `"${title}"`;

/**
 * Works out what an edit does to an existing task. The task keeps its own day unless the user
 * names one, and keeps its length unless they give a new end or length:
 *   "change the meeting to 7 pm"   -> same day, starts at 7, same length
 *   "make it 6 to 6:30"            -> same day, 30 minutes
 *   "move it to tomorrow"          -> same time, next day
 */
export function applyChange(task: Task, change: TaskChange, tz: string, now: number): AppliedChange {
  const changes: Partial<Task> = {};
  const sentences: string[] = [];
  let rescheduled = false;

  if (change.title) {
    changes.title = change.title;
    sentences.push(`Renamed ${quote(task.title)} to ${quote(change.title)}.`);
  }
  if (change.priority) {
    changes.priority = change.priority;
    sentences.push(`${quote(changes.title ?? task.title)} is now ${change.priority === 'med' ? 'normal' : change.priority} priority.`);
  }

  const title = changes.title ?? task.title;
  const fixed = task.fixedStart !== undefined && task.fixedEnd !== undefined;

  // "change it to 7" with no am/pm: take 7 am or 7 pm, whichever is nearer the task's current time
  let { startMin, endMin } = change;
  if (startMin !== undefined && change.ampmGuessed && fixed) {
    const current = minutesOfDay(task.fixedStart as number, tz);
    const face = startMin % 720;
    const gap = endMin !== undefined ? (((endMin - startMin) % 720) + 720) % 720 || 720 : undefined;
    startMin = Math.abs(face - current) <= Math.abs(face + 720 - current) ? face : face + 720;
    if (gap !== undefined) endMin = (startMin + gap) % 1440;
  }

  if (startMin !== undefined) {
    // the day: one the user named, else the task's own; a flexible task has none, so today (or tomorrow if that time has passed)
    let dayTs = change.day ?? (task.fixedStart !== undefined ? task.fixedStart : now);
    let start = atMinutesOfDay(dayTs, startMin, tz);
    if (change.day === undefined && !fixed && start < now) {
      dayTs = addDaysTz(dayTs, 1, tz);
      start = atMinutesOfDay(dayTs, startMin, tz);
    }

    let end: number;
    if (endMin !== undefined) {
      end = atMinutesOfDay(dayTs, endMin, tz);
      if (end <= start) end += DAY; // "10 pm to 2"
    } else if (change.durationMin) {
      end = start + change.durationMin * MIN;
    } else {
      end = start + (fixed ? (task.fixedEnd as number) - (task.fixedStart as number) : task.estimateMin * MIN);
    }
    Object.assign(changes, { fixedStart: start, fixedEnd: end, estimateMin: Math.round((end - start) / MIN), blocks: [] });
    rescheduled = true;
    sentences.push(`Updated ${quote(title)}: ${formatDayLabel(start, tz, now).toLowerCase()} from ${formatTime(start, tz)} to ${formatTime(end, tz)}.`);
  } else if (endMin !== undefined && fixed) {
    const start = task.fixedStart as number;
    let end = atMinutesOfDay(change.day ?? start, endMin, tz);
    if (end <= start) end += DAY;
    Object.assign(changes, { fixedEnd: end, estimateMin: Math.round((end - start) / MIN), blocks: [] });
    rescheduled = true;
    sentences.push(`Updated ${quote(title)}: now ends at ${formatTime(end, tz)}.`);
  } else if (change.day !== undefined) {
    if (fixed) {
      const dayShift = Math.round((startOfDayTz(change.day, tz) - startOfDayTz(task.fixedStart as number, tz)) / DAY);
      const start = addDaysTz(task.fixedStart as number, dayShift, tz);
      Object.assign(changes, { fixedStart: start, fixedEnd: start + ((task.fixedEnd as number) - (task.fixedStart as number)), blocks: [] });
      sentences.push(`Moved ${quote(title)} to ${formatDayLabel(start, tz, now).toLowerCase()}.`);
    } else {
      const startAfter = startOfDayTz(change.day, tz);
      const dueAt = task.dueAt !== undefined && task.dueAt < startAfter ? endOfDayTz(startAfter, tz) : task.dueAt;
      Object.assign(changes, { startAfter, dueAt, blocks: [] });
      sentences.push(`Moved ${quote(title)} to ${formatDayLabel(startAfter, tz, now).toLowerCase()}.`);
    }
    rescheduled = true;
  }

  if (change.durationMin && startMin === undefined) {
    changes.estimateMin = change.durationMin;
    changes.blocks = [];
    if (fixed) {
      changes.fixedEnd = (changes.fixedStart ?? (task.fixedStart as number)) + change.durationMin * MIN;
      rescheduled = true;
    }
    sentences.push(`${quote(title)} now takes ${formatDuration(change.durationMin)}.`);
  }

  return { changes, rescheduled, message: sentences.join(' ') || `Nothing to change on ${quote(title)}.` };
}
