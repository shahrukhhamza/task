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

export type ParsedCommand =
  | { kind: 'push'; target: string; to: number; hasTime: boolean }
  | { kind: 'finish'; target: string }
  | { kind: 'start'; target: string }
  | { kind: 'late'; minutes?: number }
  | { kind: 'next' }
  | { kind: 'delete'; target: string };

export type ParseResult =
  | { kind: 'tasks'; tasks: ParsedTask[] }
  | { kind: 'command'; command: ParsedCommand; raw: string }
  | { kind: 'empty' };
