import type { Priority, Recurrence } from '../types';

export interface ParseContext {
  now: number;
  timezone: string;
}

export interface ParsedTask {
  /** The exact text this task was parsed from. */
  raw: string;
  title: string;
  category?: string;
  priority?: Priority;
  durationMin?: number;
  /** Deadline (a date-only phrase resolves to the end of that day). */
  dueAt?: number;
  /** Appointment times; both set when the item has an exact slot. */
  fixedStart?: number;
  fixedEnd?: number;
  recurrence?: Recurrence;
  addToCalendar?: boolean;
}

/** What "update the meeting to 7 to 8 pm" asks to change about an existing task. */
export interface TaskChange {
  /** New start and end as minutes after midnight; the day is the task's own unless `day` is set. */
  startMin?: number;
  endMin?: number;
  /** Start of a day the user named ("tomorrow", "Friday"). */
  day?: number;
  /** A new length in minutes ("make it 30 minutes"). */
  durationMin?: number;
  title?: string;
  priority?: Priority;
  /**
   * True when no am/pm was said ("change it to 7"), so the clock face is a guess: the edit picks
   * whichever of 7 am / 7 pm is nearest the task's current time.
   */
  ampmGuessed?: boolean;
  /** The time the user said the task is at now ("from 6 pm to 7 pm"), minutes after midnight; helps pick between similar tasks. */
  fromMin?: number;
  /**
   * "from 6 to 7" can mean "it's at 6, make it 7" or "make it 6 to 7". When the task isn't at the
   * first time, this range is the answer.
   */
  asRange?: { startMin: number; endMin: number };
}

export type ParsedCommand =
  | { kind: 'push'; target: string; to: number; hasTime: boolean }
  | { kind: 'finish'; target: string }
  | { kind: 'start'; target: string }
  | { kind: 'late'; minutes?: number }
  | { kind: 'next' }
  | { kind: 'delete'; target: string }
  | { kind: 'calendar'; target: string }
  /** Change an existing task instead of adding a new one. `soft` means "if no such task exists, treat it as a new task". */
  | { kind: 'update'; target: string; change: TaskChange; soft?: boolean };

export type ParseResult =
  | { kind: 'tasks'; tasks: ParsedTask[] }
  | { kind: 'command'; command: ParsedCommand; raw: string }
  | { kind: 'empty' };
