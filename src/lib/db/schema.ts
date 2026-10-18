import Dexie, { type Table } from 'dexie';
import { DEFAULT_PROFILE, type FixedEvent, type Profile, type Task, type TaskEvent } from '../types';

/**
 * Local-first store. Table names mirror the Postgres tables that arrive in Phase 2
 * (blocks live inside `tasks.blocks`, which becomes a jsonb column there).
 */
export class DayflowDB extends Dexie {
  tasks!: Table<Task, string>;
  taskEvents!: Table<TaskEvent, string>;
  fixedEvents!: Table<FixedEvent, string>;
  profile!: Table<Profile, string>;

  constructor() {
    super('dayflow');
    this.version(1).stores({
      tasks: 'id, status, dueAt, updatedAt, deletedAt',
      taskEvents: 'id, taskId, type, at',
      fixedEvents: 'id, start, updatedAt',
      profile: 'id',
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
