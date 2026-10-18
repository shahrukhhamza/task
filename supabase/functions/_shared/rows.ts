// Postgres rows -> the plain shapes the analytics expect.

import type { CheckinLike, EventLike, FixedLike, HabitLike, HabitLogLike, TaskLike } from './analytics.ts';

type Row = Record<string, unknown>;

const ms = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : new Date(v as string).getTime());

export const taskFromRow = (r: Row): TaskLike => ({
  id: r.id as string,
  title: r.title as string,
  category: (r.category as string) ?? 'general',
  priority: (r.priority as string) ?? 'med',
  status: r.status as string,
  estimateMin: (r.estimate_min as number) ?? 0,
  spentMin: (r.spent_min as number) ?? 0,
  dueAt: ms(r.due_at),
  fixedStart: ms(r.fixed_start),
  fixedEnd: ms(r.fixed_end),
  blocks: ((r.blocks as Array<{ start: number; end: number }>) ?? []).map((b) => ({ start: b.start, end: b.end })),
  createdAt: ms(r.created_at) ?? 0,
  completedAt: ms(r.completed_at),
  deletedAt: ms(r.deleted_at) ?? null,
});

export const eventFromRow = (r: Row): EventLike => ({
  taskId: r.task_id as string,
  type: r.type as string,
  at: ms(r.at) ?? 0,
  durationMin: (r.duration_min as number | null) ?? undefined,
  category: (r.category as string | null) ?? undefined,
});

export const fixedFromRow = (r: Row): FixedLike => ({
  title: r.title as string,
  start: ms(r.start_at) ?? 0,
  end: ms(r.end_at) ?? 0,
  deletedAt: ms(r.deleted_at) ?? null,
});

export const checkinFromRow = (r: Row): CheckinLike => ({
  date: String(r.date).slice(0, 10),
  mood: r.mood as number,
  energy: r.energy as number,
});

export const habitFromRow = (r: Row): HabitLike => ({
  id: r.id as string,
  title: r.title as string,
  days: (r.days as number[]) ?? [0, 1, 2, 3, 4, 5, 6],
  archived: (r.archived as boolean) ?? false,
  deletedAt: ms(r.deleted_at) ?? null,
  createdAt: ms(r.created_at) ?? 0,
});

export const habitLogFromRow = (r: Row): HabitLogLike => ({
  habitId: r.habit_id as string,
  date: String(r.date).slice(0, 10),
  deletedAt: ms(r.deleted_at) ?? null,
});
