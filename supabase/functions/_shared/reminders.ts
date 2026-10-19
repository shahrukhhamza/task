// Which notifications are due, shared by the in-app notifier and the send-reminders function.
// Everything here is pure: the caller passes the clock and the tasks.

import { addDays, clock, dayBounds, dayKeyOf, duration, localParts } from './zone.ts';

const MIN = 60_000;
const ACTIVE = new Set(['todo', 'scheduled', 'doing']);
/** A morning or evening push is sent up to this long after its time, in case a cron run was missed. */
const WINDOW_MIN = 30;
/** Deadlines with a set time get a heads-up this long before. */
const DEADLINE_LEAD_MIN = 60;

export interface ReminderTask {
  id: string;
  title: string;
  status: string;
  blocks: Array<{ id: string; start: number; end: number }>;
  fixedStart?: number;
  fixedEnd?: number;
  dueAt?: number;
  completedAt?: number;
  deletedAt?: number | null;
}

export interface DueReminder {
  key: string;
  title: string;
  start: number;
  end: number;
}

export interface PushPrefs {
  morning: boolean;
  /** Local "HH:MM". */
  morningTime: string;
  deadlines: boolean;
  evening: boolean;
  eveningTime: string;
}

/** A push ready to send; `key` makes sure each one goes out once. */
export interface Notice {
  key: string;
  title: string;
  body: string;
  tag: string;
  url: string;
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

// ------------------------------------------------------------------ digests and deadlines

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** True from `time` until WINDOW_MIN minutes later, on the user's clock. */
function inWindow(now: number, tz: string, time: string): boolean {
  const p = localParts(now, tz);
  const since = p.hour * 60 + p.minute - minutesOf(time);
  return since >= 0 && since < WINDOW_MIN;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What is planned inside [start, end): appointments, planned blocks and deadlines, earliest first. */
function itemsBetween(tasks: ReminderTask[], start: number, end: number): Array<{ title: string; at: number; kind: 'start' | 'due' }> {
  const items: Array<{ title: string; at: number; kind: 'start' | 'due' }> = [];
  for (const t of tasks) {
    if (t.deletedAt || !ACTIVE.has(t.status)) continue;
    const slots = t.fixedStart !== undefined ? [t.fixedStart] : t.blocks.map((b) => b.start);
    // a task planned in several chunks counts once, at its first chunk of the day
    const first = slots.filter((s) => s >= start && s < end).sort((a, b) => a - b)[0];
    if (first !== undefined) items.push({ title: t.title, at: first, kind: 'start' });
    else if (t.dueAt !== undefined && t.dueAt >= start && t.dueAt < end) items.push({ title: t.title, at: t.dueAt, kind: 'due' });
  }
  return items.sort((a, b) => a.at - b.at);
}

/** "Good morning" push: how many things today, what comes first, what is due. */
export function morningNotice(tasks: ReminderTask[], tz: string, now: number): Notice | null {
  const day = dayKeyOf(now, tz);
  const { start, end } = dayBounds(day, tz);
  const items = itemsBetween(tasks, start, end).filter((i) => i.kind === 'start' || i.at >= now);
  if (!items.length) return null;

  const first = items.find((i) => i.kind === 'start') ?? items[0];
  const due = items.filter((i) => i.kind === 'due');
  const parts = [`First up: ${first.title} at ${clock(first.at, tz)}`];
  if (due.length) parts.push(`Due today: ${due.slice(0, 2).map((d) => d.title).join(', ')}${due.length > 2 ? ` +${due.length - 2}` : ''}`);
  return {
    key: `morning:${day}`,
    title: `Today: ${plural(items.length, 'thing')} planned`,
    body: parts.join(' · '),
    tag: `morning:${day}`,
    url: '/',
  };
}

/** Evening wrap-up: what got done, what is still open, how tomorrow starts. */
export function eveningNotice(tasks: ReminderTask[], tz: string, now: number): Notice | null {
  const day = dayKeyOf(now, tz);
  const today = dayBounds(day, tz);
  const tomorrow = dayBounds(addDays(day, 1), tz);

  const done = tasks.filter((t) => t.status === 'done' && t.completedAt !== undefined && t.completedAt >= today.start && t.completedAt < today.end).length;
  const open = itemsBetween(tasks, today.start, today.end).length;
  const next = itemsBetween(tasks, tomorrow.start, tomorrow.end)[0];
  if (!done && !open && !next) return null;

  const head = open === 0 ? (done ? `All done: ${plural(done, 'task')} finished today` : 'Nothing left for today') : `${done} done, ${open} still open`;
  const tail = next ? ` · Tomorrow starts with ${next.title}${next.kind === 'start' ? ` at ${clock(next.at, tz)}` : ''}` : '';
  return {
    key: `evening:${day}`,
    title: open === 0 && done ? 'Nice work today' : 'Wrapping up the day',
    body: `${head}${tail}`,
    tag: `evening:${day}`,
    url: '/',
  };
}

/** Heads-up before a deadline that has a set time (date-only deadlines are covered by the morning push). */
export function deadlineNotices(tasks: ReminderTask[], tz: string, now: number): Notice[] {
  const out: Notice[] = [];
  for (const t of tasks) {
    if (t.deletedAt || !ACTIVE.has(t.status) || t.dueAt === undefined) continue;
    const p = localParts(t.dueAt, tz);
    if (p.hour * 60 + p.minute >= 23 * 60 + 59) continue; // end of day means "any time that day"
    if (t.dueAt <= now || t.dueAt > now + (DEADLINE_LEAD_MIN + 1) * MIN) continue;
    const mins = Math.max(1, Math.round((t.dueAt - now) / MIN));
    out.push({
      key: `due:${t.id}:${t.dueAt}`,
      title: `Due in ${mins} min: ${t.title}`,
      body: `Deadline at ${clock(t.dueAt, tz)}. Open Dayflow to finish it or move it.`,
      tag: `due:${t.id}`,
      url: '/',
    });
  }
  return out;
}

/** Everything beyond the per-block reminders that is due right now. */
export function dueNotices(target: { timezone: string; tasks: ReminderTask[]; prefs?: Partial<PushPrefs> }, now: number): Notice[] {
  const { timezone: tz, tasks, prefs = {} } = target;
  const out: Notice[] = [];
  if (prefs.morning && inWindow(now, tz, prefs.morningTime ?? '08:00')) {
    const n = morningNotice(tasks, tz, now);
    if (n) out.push(n);
  }
  if (prefs.deadlines) out.push(...deadlineNotices(tasks, tz, now));
  if (prefs.evening && inWindow(now, tz, prefs.eveningTime ?? '20:30')) {
    const n = eveningNotice(tasks, tz, now);
    if (n) out.push(n);
  }
  return out;
}
