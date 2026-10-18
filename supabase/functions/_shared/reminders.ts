// Which reminders are due, shared by the in-app notifier and the send-reminders function.

import { clock, duration } from './zone.ts';

const MIN = 60_000;
const ACTIVE = new Set(['todo', 'scheduled', 'doing']);

export interface ReminderTask {
  id: string;
  title: string;
  status: string;
  blocks: Array<{ id: string; start: number; end: number }>;
  fixedStart?: number;
  fixedEnd?: number;
  deletedAt?: number | null;
}

export interface DueReminder {
  key: string;
  title: string;
  start: number;
  end: number;
}

/**
 * Blocks and appointments starting within the lead time. The extra minute covers
 * the gap between cron runs, so nothing slips through.
 */
export function dueReminders(target: { leadMin: number; tasks: ReminderTask[] }, now: number): DueReminder[] {
  const until = now + target.leadMin * MIN + MIN;
  const due: DueReminder[] = [];
  for (const t of target.tasks) {
    if (t.deletedAt || !ACTIVE.has(t.status)) continue;
    for (const b of t.blocks) if (b.start > now && b.start <= until) due.push({ key: b.id, title: t.title, start: b.start, end: b.end });
    if (t.fixedStart !== undefined && t.fixedStart > now && t.fixedStart <= until) {
      due.push({ key: `fixed:${t.id}:${t.fixedStart}`, title: t.title, start: t.fixedStart, end: t.fixedEnd ?? t.fixedStart });
    }
  }
  return due.sort((a, b) => a.start - b.start);
}

export function reminderPayload(r: DueReminder, tz: string, now: number) {
  const mins = Math.max(1, Math.round((r.start - now) / MIN));
  return {
    title: `Up next: ${r.title}`,
    body: `${clock(r.start, tz)} – ${clock(r.end, tz)} · ${duration((r.end - r.start) / MIN)} · starts in ${mins} min`,
    tag: r.key,
    url: '/',
  };
}
