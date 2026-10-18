import { DEFAULT_PROFILE, type CalendarLink, type Checkin, type FixedEvent, type Habit, type HabitLog, type Profile, type Task, type TaskEvent } from '../types';

/** A row as Postgres/PostgREST sees it (snake_case, ISO timestamps). */
export type Row = Record<string, unknown>;

const iso = (ms: number | null | undefined): string | null => (ms === undefined || ms === null ? null : new Date(ms).toISOString());
const ms = (value: unknown): number | undefined => (value === null || value === undefined ? undefined : new Date(value as string).getTime());
const msOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : new Date(value as string).getTime());
const opt = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

export interface TableMapper<T> {
  /** Dexie table name. */
  local: 'profile' | 'tasks' | 'taskEvents' | 'fixedEvents' | 'habits' | 'habitLogs' | 'checkins' | 'calendarLinks';
  /** Postgres table name. */
  remote: string;
  conflictKey: string;
  toRow(item: T, userId: string): Row;
  fromRow(row: Row): T;
  /** Rows created before sync existed have no flag and count as unsynced. */
  isDirty(item: T): boolean;
  updatedAt(item: T): number;
}

const dirty = (s: { syncState?: string }) => s.syncState !== 'synced';

export const profileMapper: TableMapper<Profile> = {
  local: 'profile',
  remote: 'profiles',
  conflictKey: 'id',
  toRow: (p, userId) => ({
    id: userId,
    timezone: p.timezone,
    work_start: p.workStart,
    work_end: p.workEnd,
    peak_start: p.peakStart,
    peak_end: p.peakEnd,
    max_chunk_min: p.maxChunkMin,
    max_focus_min: p.maxFocusMin,
    break_min: p.breakMin,
    buffer_min: p.bufferMin,
    theme: p.theme,
    voice_lang: p.voiceLang,
    email_enabled: p.emailEnabled,
    email_time: p.emailTime,
    email_recipient: p.emailRecipient,
    email_weekly: p.emailWeekly,
    reminders_enabled: p.remindersEnabled,
    reminder_lead_min: p.reminderLeadMin,
    updated_at: iso(p.updatedAt),
  }),
  // the local profile always uses the id "me"; the server keys it by user id
  fromRow: (r) => ({
    ...DEFAULT_PROFILE,
    id: 'me',
    timezone: r.timezone as string,
    workStart: r.work_start as number,
    workEnd: r.work_end as number,
    peakStart: r.peak_start as number,
    peakEnd: r.peak_end as number,
    maxChunkMin: r.max_chunk_min as number,
    maxFocusMin: r.max_focus_min as number,
    breakMin: r.break_min as number,
    bufferMin: r.buffer_min as number,
    theme: r.theme as Profile['theme'],
    voiceLang: r.voice_lang as string,
    emailEnabled: r.email_enabled as boolean,
    emailTime: r.email_time as string,
    emailRecipient: r.email_recipient as string,
    emailWeekly: r.email_weekly as boolean,
    remindersEnabled: r.reminders_enabled as boolean,
    reminderLeadMin: r.reminder_lead_min as number,
    updatedAt: ms(r.updated_at) ?? 0,
    syncState: 'synced',
  }),
  // a profile nobody has edited yet must never overwrite the server's (e.g. the sign-up email)
  isDirty: (p) => p.updatedAt > 0 && dirty(p),
  updatedAt: (p) => p.updatedAt,
};

export const taskMapper: TableMapper<Task> = {
  local: 'tasks',
  remote: 'tasks',
  conflictKey: 'user_id,id',
  toRow: (t, userId) => ({
    user_id: userId,
    id: t.id,
    title: t.title,
    notes: t.notes ?? null,
    category: t.category,
    priority: t.priority,
    due_at: iso(t.dueAt),
    fixed_start: iso(t.fixedStart),
    fixed_end: iso(t.fixedEnd),
    start_after: iso(t.startAfter),
    carried_over_at: iso(t.carriedOverAt),
    estimate_min: Math.round(t.estimateMin),
    spent_min: Math.round(t.spentMin),
    status: t.status,
    recurrence: t.recurrence ?? null,
    blocks: t.blocks,
    calendar_event_id: t.calendarEventId ?? null,
    add_to_calendar: !!t.addToCalendar,
    created_at: iso(t.createdAt),
    completed_at: iso(t.completedAt),
    updated_at: iso(t.updatedAt),
    deleted_at: iso(t.deletedAt),
  }),
  fromRow: (r) => ({
    id: r.id as string,
    title: r.title as string,
    notes: opt(r.notes as string | null),
    category: r.category as string,
    priority: r.priority as Task['priority'],
    dueAt: ms(r.due_at),
    fixedStart: ms(r.fixed_start),
    fixedEnd: ms(r.fixed_end),
    startAfter: ms(r.start_after),
    carriedOverAt: ms(r.carried_over_at),
    estimateMin: r.estimate_min as number,
    spentMin: r.spent_min as number,
    status: r.status as Task['status'],
    recurrence: opt(r.recurrence as Task['recurrence'] | null),
    blocks: (r.blocks as Task['blocks']) ?? [],
    calendarEventId: opt(r.calendar_event_id as string | null),
    addToCalendar: (r.add_to_calendar as boolean) || undefined,
    createdAt: ms(r.created_at) ?? 0,
    completedAt: ms(r.completed_at),
    updatedAt: ms(r.updated_at) ?? 0,
    deletedAt: msOrNull(r.deleted_at),
    syncState: 'synced',
  }),
  isDirty: dirty,
  updatedAt: (t) => t.updatedAt,
};

export const taskEventMapper: TableMapper<TaskEvent> = {
  local: 'taskEvents',
  remote: 'task_events',
  conflictKey: 'user_id,id',
  toRow: (e, userId) => ({
    user_id: userId,
    id: e.id,
    task_id: e.taskId,
    type: e.type,
    at: iso(e.at),
    duration_min: e.durationMin ?? null,
    category: e.category ?? null,
    // events never change, so their timestamp doubles as the sync cursor
    updated_at: iso(e.at),
  }),
  fromRow: (r) => ({
    id: r.id as string,
    taskId: r.task_id as string,
    type: r.type as TaskEvent['type'],
    at: ms(r.at) ?? 0,
    durationMin: opt(r.duration_min as number | null),
    category: opt(r.category as string | null),
    syncState: 'synced',
  }),
  isDirty: dirty,
  updatedAt: (e) => e.at,
};

export const fixedEventMapper: TableMapper<FixedEvent> = {
  local: 'fixedEvents',
  remote: 'fixed_events',
  conflictKey: 'user_id,id',
  toRow: (e, userId) => ({
    user_id: userId,
    id: e.id,
    title: e.title,
    start_at: iso(e.start),
    end_at: iso(e.end),
    source: e.source,
    external_id: e.externalId ?? null,
    updated_at: iso(e.updatedAt),
    deleted_at: iso(e.deletedAt),
  }),
  fromRow: (r) => ({
    id: r.id as string,
    title: r.title as string,
    start: ms(r.start_at) ?? 0,
    end: ms(r.end_at) ?? 0,
    source: r.source as FixedEvent['source'],
    externalId: opt(r.external_id as string | null),
    updatedAt: ms(r.updated_at) ?? 0,
    deletedAt: msOrNull(r.deleted_at),
    syncState: 'synced',
  }),
  isDirty: dirty,
  updatedAt: (e) => e.updatedAt,
};

export const habitMapper: TableMapper<Habit> = {
  local: 'habits',
  remote: 'habits',
  conflictKey: 'user_id,id',
  toRow: (h, userId) => ({
    user_id: userId,
    id: h.id,
    title: h.title,
    category: h.category,
    days: h.days,
    archived: !!h.archived,
    created_at: iso(h.createdAt),
    updated_at: iso(h.updatedAt),
    deleted_at: iso(h.deletedAt),
  }),
  fromRow: (r) => ({
    id: r.id as string,
    title: r.title as string,
    category: r.category as string,
    days: r.days as number[],
    archived: (r.archived as boolean) || undefined,
    createdAt: ms(r.created_at) ?? 0,
    updatedAt: ms(r.updated_at) ?? 0,
    deletedAt: msOrNull(r.deleted_at),
    syncState: 'synced',
  }),
  isDirty: dirty,
  updatedAt: (h) => h.updatedAt,
};

export const habitLogMapper: TableMapper<HabitLog> = {
  local: 'habitLogs',
  remote: 'habit_logs',
  conflictKey: 'user_id,id',
  toRow: (l, userId) => ({
    user_id: userId,
    id: l.id,
    habit_id: l.habitId,
    date: l.date,
    updated_at: iso(l.updatedAt),
    deleted_at: iso(l.deletedAt),
  }),
  fromRow: (r) => ({
    id: r.id as string,
    habitId: r.habit_id as string,
    date: String(r.date).slice(0, 10),
    updatedAt: ms(r.updated_at) ?? 0,
    deletedAt: msOrNull(r.deleted_at),
    syncState: 'synced',
  }),
  isDirty: dirty,
  updatedAt: (l) => l.updatedAt,
};

export const checkinMapper: TableMapper<Checkin> = {
  local: 'checkins',
  remote: 'checkins',
  conflictKey: 'user_id,id',
  toRow: (c, userId) => ({
    user_id: userId,
    id: c.id,
    date: c.date,
    mood: c.mood,
    energy: c.energy,
    note: c.note ?? null,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  }),
  fromRow: (r) => ({
    id: r.id as string,
    date: String(r.date).slice(0, 10),
    mood: r.mood as Checkin['mood'],
    energy: r.energy as Checkin['energy'],
    note: opt(r.note as string | null),
    createdAt: ms(r.created_at) ?? 0,
    updatedAt: ms(r.updated_at) ?? 0,
    syncState: 'synced',
  }),
  isDirty: dirty,
  updatedAt: (c) => c.updatedAt,
};

export const calendarLinkMapper: TableMapper<CalendarLink> = {
  local: 'calendarLinks',
  remote: 'calendar_links',
  conflictKey: 'user_id,id',
  toRow: (l, userId) => ({
    user_id: userId,
    id: l.id,
    task_id: l.taskId,
    event_id: l.eventId,
    calendar_id: l.calendarId,
    payload_hash: l.payloadHash,
    updated_at: iso(l.updatedAt),
    deleted_at: iso(l.deletedAt),
  }),
  fromRow: (r) => ({
    id: r.id as string,
    taskId: r.task_id as string,
    eventId: r.event_id as string,
    calendarId: r.calendar_id as string,
    payloadHash: r.payload_hash as string,
    updatedAt: ms(r.updated_at) ?? 0,
    deletedAt: msOrNull(r.deleted_at),
    syncState: 'synced',
  }),
  isDirty: dirty,
  updatedAt: (l) => l.updatedAt,
};

/** Order matters only for readability on the server; there are no foreign keys between these. */
export const MAPPERS = [
  profileMapper,
  taskMapper,
  taskEventMapper,
  fixedEventMapper,
  habitMapper,
  habitLogMapper,
  checkinMapper,
  calendarLinkMapper,
] as const;

/**
 * Last write wins. A remote row replaces the local one unless the local copy has
 * unsynced edits that are newer.
 */
export function shouldApplyRemote(
  local: { updatedAt: number; dirty: boolean } | undefined,
  remoteUpdatedAt: number,
): boolean {
  if (!local) return true;
  if (!local.dirty) return remoteUpdatedAt >= local.updatedAt;
  return remoteUpdatedAt > local.updatedAt;
}
