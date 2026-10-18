/** Shared domain types. Times are UTC epoch milliseconds; the user's timezone is applied only for display and day boundaries. */

export type Priority = 'high' | 'med' | 'low';

export type TaskStatus = 'todo' | 'scheduled' | 'doing' | 'done' | 'skipped' | 'dropped';

export type SyncState = 'local' | 'synced' | 'dirty';

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** Weekdays for weekly rules, 0 = Sunday. */
  byDay?: number[];
}

/** A scheduled slice of a task. Long tasks are split into several chunks. */
export interface Block {
  id: string;
  taskId: string;
  start: number;
  end: number;
  chunk: number;
  chunks: number;
  /** Set when the user dragged the block; the planner keeps it where it is. */
  locked?: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  category: string;
  priority: Priority;
  /** Hard deadline. */
  dueAt?: number;
  /** Set for appointments that must happen at an exact time. */
  fixedStart?: number;
  fixedEnd?: number;
  /** Set when a block from an earlier day was left undone and the task rolled into a new plan. */
  carriedOverAt?: number;
  /** Earliest moment the planner may start the task (set when a task is pushed to a later day). */
  startAfter?: number;
  /** The user's (or default) estimate in minutes. */
  estimateMin: number;
  /** Focus minutes already spent on the task. */
  spentMin: number;
  status: TaskStatus;
  recurrence?: Recurrence;
  blocks: Block[];
  /** Google Calendar event id once linked (Phase 2). */
  calendarEventId?: string;
  addToCalendar?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  deletedAt?: number | null;
  syncState: SyncState;
}

export type TaskEventType =
  | 'created'
  | 'started'
  | 'focus'
  | 'completed'
  | 'skipped'
  | 'rescheduled'
  | 'dropped';

/** Status history; actual durations are derived from these rows. */
export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  at: number;
  /** Minutes, for `focus` events. */
  durationMin?: number;
  category?: string;
}

export interface FixedEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  source: 'manual' | 'google';
  externalId?: string;
  updatedAt: number;
  deletedAt?: number | null;
  syncState: SyncState;
}

export interface Profile {
  id: string;
  timezone: string;
  /** Minutes after midnight. */
  workStart: number;
  workEnd: number;
  peakStart: number;
  peakEnd: number;
  /** Longest uninterrupted work block in minutes. */
  maxChunkMin: number;
  /** Most focused work the planner will put in a single day, to keep plans humane. */
  maxFocusMin: number;
  breakMin: number;
  bufferMin: number;
  theme: 'system' | 'light' | 'dark';
  voiceLang: string;
  updatedAt: number;
}

export const DEFAULT_TIMEZONE = 'Asia/Karachi';

export const DEFAULT_PROFILE: Profile = {
  id: 'me',
  timezone: DEFAULT_TIMEZONE,
  workStart: 9 * 60,
  workEnd: 18 * 60,
  peakStart: 9 * 60,
  peakEnd: 12 * 60,
  maxChunkMin: 90,
  maxFocusMin: 360,
  breakMin: 10,
  bufferMin: 10,
  theme: 'system',
  voiceLang: 'en-US',
  updatedAt: 0,
};
