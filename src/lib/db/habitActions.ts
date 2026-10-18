import type { Checkin, Habit } from '../types';
import { db, newId } from './schema';
import type { Undo } from './actions';

export async function addHabit(input: { title: string; days: number[]; category?: string }): Promise<{ habit: Habit; undo: Undo }> {
  const now = Date.now();
  const habit: Habit = {
    id: newId(),
    title: input.title.trim(),
    category: input.category ?? 'personal',
    days: [...new Set(input.days)].sort(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'dirty',
  };
  await db.habits.put(habit);
  return { habit, undo: () => db.habits.update(habit.id, { deletedAt: Date.now(), updatedAt: Date.now(), syncState: 'dirty' }).then(() => undefined) };
}

export async function updateHabit(id: string, changes: Partial<Pick<Habit, 'title' | 'days' | 'category' | 'archived'>>): Promise<void> {
  await db.habits.update(id, { ...changes, updatedAt: Date.now(), syncState: 'dirty' });
}

export async function deleteHabit(id: string): Promise<Undo> {
  const before = await db.habits.get(id);
  await db.habits.update(id, { deletedAt: Date.now(), updatedAt: Date.now(), syncState: 'dirty' });
  return async () => {
    if (before) await db.habits.put({ ...before, deletedAt: null, updatedAt: Date.now(), syncState: 'dirty' });
  };
}

/** Checks a habit off for a day, or un-checks it. Logs have stable ids so devices agree. */
export async function toggleHabit(habitId: string, date: string): Promise<boolean> {
  const id = `${habitId}:${date}`;
  const existing = await db.habitLogs.get(id);
  const done = !existing || !!existing.deletedAt;
  await db.habitLogs.put({ id, habitId, date, updatedAt: Date.now(), deletedAt: done ? null : Date.now(), syncState: 'dirty' });
  return done;
}

export async function saveCheckin(date: string, values: Pick<Checkin, 'mood' | 'energy' | 'note'>): Promise<void> {
  const existing = await db.checkins.get(date);
  const now = Date.now();
  await db.checkins.put({
    id: date,
    date,
    mood: values.mood,
    energy: values.energy,
    note: values.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    syncState: 'dirty',
  });
}
