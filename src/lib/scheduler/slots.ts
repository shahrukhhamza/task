import { addDaysTz, atMinutesOfDay, MIN, startOfDayTz } from '../time/tz';
import type { FixedItem, Interval, PlannerConfig, SchedulerInput } from './types';

export const GRID_MS = 5 * MIN;

export const ceilToGrid = (ts: number): number => Math.ceil(ts / GRID_MS) * GRID_MS;

/** A free stretch inside one working day, tagged with that day's peak window. */
export interface Slot extends Interval {
  day: number;
  peakStart: number;
  peakEnd: number;
}

/** Removes `cut` from every interval, splitting where needed. */
export function subtract<T extends Interval>(slots: T[], cut: Interval): T[] {
  const out: T[] = [];
  for (const s of slots) {
    if (cut.end <= s.start || cut.start >= s.end) {
      out.push(s);
      continue;
    }
    if (cut.start > s.start) out.push({ ...s, end: cut.start });
    if (cut.end < s.end) out.push({ ...s, start: cut.end });
  }
  return out;
}

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** Fixed events, appointments and anything else the planner must not touch. */
export function collectFixed(input: Pick<SchedulerInput, 'tasks' | 'fixedEvents'>): FixedItem[] {
  const items: FixedItem[] = [];
  for (const e of input.fixedEvents) {
    if (e.deletedAt) continue;
    items.push({ id: e.id, title: e.title, start: e.start, end: e.end, source: 'event' });
  }
  for (const t of input.tasks) {
    if (t.deletedAt || t.fixedStart === undefined || t.fixedEnd === undefined) continue;
    if (t.status === 'dropped' || t.status === 'skipped') continue;
    items.push({
      id: `task:${t.id}`,
      title: t.title,
      start: t.fixedStart,
      end: t.fixedEnd,
      source: 'task',
      taskId: t.id,
      done: t.status === 'done',
    });
  }
  return items.sort((a, b) => a.start - b.start);
}

/** One working window per day for the horizon, clipped so nothing starts in the past. */
export function workWindows(config: PlannerConfig, now: number, from: number, horizonDays: number): Slot[] {
  const first = startOfDayTz(now, config.timezone);
  const windows: Slot[] = [];
  for (let day = 0; day < horizonDays; day++) {
    const dayTs = addDaysTz(first, day, config.timezone);
    const start = Math.max(atMinutesOfDay(dayTs, config.workStart, config.timezone), from);
    const end = atMinutesOfDay(dayTs, config.workEnd, config.timezone);
    if (start >= end) continue;
    windows.push({
      day,
      start,
      end,
      peakStart: atMinutesOfDay(dayTs, config.peakStart, config.timezone),
      peakEnd: atMinutesOfDay(dayTs, config.peakEnd, config.timezone),
    });
  }
  return windows;
}

/** Splits a slot into the part inside the peak window and the parts outside it. */
export function splitByPeak(slot: Slot): Array<Slot & { peak: boolean }> {
  const out: Array<Slot & { peak: boolean }> = [];
  const peakA = Math.max(slot.start, slot.peakStart);
  const peakB = Math.min(slot.end, slot.peakEnd);
  if (peakA >= peakB) return [{ ...slot, peak: false }];
  if (slot.start < peakA) out.push({ ...slot, end: peakA, peak: false });
  out.push({ ...slot, start: peakA, end: peakB, peak: true });
  if (peakB < slot.end) out.push({ ...slot, start: peakB, peak: false });
  return out;
}
