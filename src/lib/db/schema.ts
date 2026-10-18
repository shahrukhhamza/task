import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_PROFILE,
  type CalendarLink,
  type Checkin,
  type FixedEvent,
  type Habit,
  type HabitLog,
  type Profile,
  type Task,
  type TaskEvent,
} from '../types';

/** Bookkeeping for sync, e.g. the last time each table was pulled from the server. */
export interface SyncMeta {
  key: string;
  value: string;
}

/**
 * Local-first store. Table names mirror the Postgres tables in supabase/migrations
 * (blocks live inside `tasks.blocks`, a jsonb column on the server).
 */
export class DayflowDB extends Dexie {
  tasks!: Table<Task, string>;
  taskEvents!: Table<TaskEvent, string>;
  fixedEvents!: Table<FixedEvent, string>;
  profile!: Table<Profile, string>;
  habits!: Table<Habit, string>;
  habitLogs!: Table<HabitLog, string>;
  checkins!: Table<Checkin, string>;
  calendarLinks!: Table<CalendarLink, string>;
  syncMeta!: Table<SyncMeta, string>;

  constructor(name = 'dayflow') {
    super(name);
    this.version(1).stores({
      tasks: 'id, status, dueAt, updatedAt, deletedAt',
      taskEvents: 'id, taskId, type, at',
      fixedEvents: 'id, start, updatedAt',
      profile: 'id',
    });
    this.version(2).stores({
      habits: 'id, updatedAt',
      habitLogs: 'id, habitId, date',
      checkins: 'id, date',
      calendarLinks: 'id, taskId',
      syncMeta: 'key',
    });
  }
}

export const db = new DayflowDB();

export const newId = (): string => crypto.randomUUID();

export async function ensureProfile(): Promise<Profile> {
  const existing = await db.profile.get('me');
  if (existing) return { ...DEFAULT_PROFILE, ...existing };
  await db.profile.put(DEFAULT_PROFILE);
  return DEFAULT_PROFILE;
}
