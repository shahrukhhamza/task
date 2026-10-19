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
  /** Rows created before sync existed have no flag and count as unsynced. */
  syncState?: SyncState;
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
  /** Nightly summary email. */
  emailEnabled: boolean;
  /** Local time of day, "HH:MM", in `timezone`. */
  emailTime: string;
  emailRecipient: string;
  emailWeekly: boolean;
  remindersEnabled: boolean;
  /** Minutes before a block starts. */
  reminderLeadMin: number;
  /** A morning plan push at `pushMorningTime` (local "HH:MM"). */
  pushMorning: boolean;
  pushMorningTime: string;
  /** A heads-up an hour before a deadline that has a set time. */
  pushDeadlines: boolean;
  /** An evening wrap-up push at `pushEveningTime`. */
  pushEvening: boolean;
  pushEveningTime: string;
  updatedAt: number;
  syncState?: SyncState;
}

export interface Habit {
  id: string;
  title: string;
  category: string;
  /** Weekdays the habit applies to, 0 = Sunday. All seven means daily. */
  days: number[];
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  syncState: SyncState;
}

/** One row per habit per local day; un-checking soft-deletes it. */
export interface HabitLog {
  id: string;
  habitId: string;
  /** Local date, yyyy-MM-dd. */
  date: string;
  updatedAt: number;
  deletedAt?: number | null;
  syncState: SyncState;
}

/** Evening check-in; the id is the local date so there is at most one per day. */
export interface Checkin {
  id: string;
  date: string;
  mood: 1 | 2 | 3 | 4 | 5;
  energy: 1 | 2 | 3 | 4 | 5;
  note?: string;
  createdAt: number;
  updatedAt: number;
  syncState: SyncState;
}

/** Maps a task to its Google Calendar event so edits and deletes stay in sync. */
export interface CalendarLink {
  id: string;
  taskId: string;
  eventId: string;
  calendarId: string;
  /** Hash of what was last written to Google, to detect when an update is needed. */
  payloadHash: string;
  updatedAt: number;
  deletedAt?: number | null;
  syncState: SyncState;
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
  emailEnabled: false,
  emailTime: '21:30',
  emailRecipient: '',
  emailWeekly: true,
  remindersEnabled: false,
  reminderLeadMin: 5,
  pushMorning: true,
  pushMorningTime: '08:00',
  pushDeadlines: true,
  pushEvening: true,
  pushEveningTime: '20:30',
  updatedAt: 0,
};
