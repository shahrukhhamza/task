import type { DayflowDB } from '../db/schema';
import { addDaysTz, startOfDayTz } from '../time/tz';
import type { CalendarLink, FixedEvent, Task } from '../types';
import { googleEventId, googleEventPayload, payloadHash } from './event';

export type CalendarErrorCode = 'reconnect_required' | 'not_connected' | 'not_configured' | 'unauthorized' | 'network' | 'google_error';

export class CalendarError extends Error {
  constructor(
    public code: CalendarErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Calls the google-calendar Edge Function. Throws CalendarError on failure. */
export type Invoke = <T = Record<string, unknown>>(body: Record<string, unknown>) => Promise<T>;

interface RemoteEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  transparent: boolean;
  declined: boolean;
  fromDayflow: boolean;
}

export const IMPORT_DAYS = 14;

/**
 * Pulls the next two weeks of Google events into fixed_events so the planner never
 * double-books. All-day, "free", declined and Dayflow-created events are skipped.
 */
export async function importGoogleEvents(invoke: Invoke, db: DayflowDB, now: number, tz: string) {
  const from = startOfDayTz(now, tz);
  const to = addDaysTz(from, IMPORT_DAYS, tz);
  const { events } = await invoke<{ events: RemoteEvent[] }>({
    action: 'list',
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
  });

  const wanted = new Map<string, RemoteEvent>();
  for (const e of events) {
    if (!e.allDay && !e.transparent && !e.declined && !e.fromDayflow && e.end > e.start) wanted.set(`google:${e.id}`, e);
  }

  const existing = (await db.fixedEvents.toArray()).filter((f) => f.source === 'google' && !f.deletedAt);
  const stamp = Date.now();
  const writes: FixedEvent[] = [];
  let added = 0;
  let removed = 0;

  for (const [id, e] of wanted) {
    const current = existing.find((f) => f.id === id);
    if (current && current.title === e.title && current.start === e.start && current.end === e.end) continue;
    if (!current) added++;
    writes.push({ id, title: e.title, start: e.start, end: e.end, source: 'google', externalId: e.id, updatedAt: stamp, deletedAt: null, syncState: 'dirty' });
  }
  // an event inside the window that Google no longer returns was moved away or deleted
  for (const f of existing) {
    if (!wanted.has(f.id) && f.start < to && f.end > from) {
      writes.push({ ...f, deletedAt: stamp, updatedAt: stamp, syncState: 'dirty' });
      removed++;
    }
  }
  if (writes.length) await db.fixedEvents.bulkPut(writes);
  return { added, updated: writes.length - added - removed, removed };
}

/**
 * Makes Google match the tasks that should be on the calendar: creates events for
 * newly flagged tasks, updates moved ones and deletes events for removed tasks.
 */
export async function syncCalendarLinks(invoke: Invoke, db: DayflowDB, tz: string) {
  const [tasks, links] = await Promise.all([db.tasks.toArray(), db.calendarLinks.toArray()]);
  const linkFor = new Map(links.filter((l) => !l.deletedAt).map((l) => [l.taskId, l]));
  const result = { created: 0, updated: 0, deleted: 0 };

  const saveLink = (link: CalendarLink) => db.calendarLinks.put(link);
  const setTaskEvent = (task: Task, eventId: string | undefined) =>
    task.calendarEventId === eventId
      ? Promise.resolve()
      : db.tasks.update(task.id, { calendarEventId: eventId, updatedAt: Date.now(), syncState: 'dirty' });

  for (const task of tasks) {
    const link = linkFor.get(task.id);
    const gone = !!task.deletedAt || task.status === 'dropped' || (task.status === 'skipped' && task.fixedStart !== undefined);
    const wanted = !!task.addToCalendar && !gone;

    if (!wanted) {
      if (link) {
        await invoke({ action: 'delete', eventId: link.eventId });
        await saveLink({ ...link, deletedAt: Date.now(), updatedAt: Date.now(), syncState: 'dirty' });
        await setTaskEvent(task, undefined);
        result.deleted++;
      }
      continue;
    }

    // finished tasks keep any event they have as a record, and never get a new one
    if (task.status === 'done') continue;

    const payload = googleEventPayload(task, tz);
    if (!payload) continue; // not planned yet; try again after the next plan
    const hash = payloadHash(payload);
    if (link && link.payloadHash === hash) continue;

    const { eventId } = await invoke<{ eventId: string }>({
      action: 'upsert',
      eventId: link?.eventId ?? googleEventId(task.id),
      event: payload,
    });
    await saveLink({
      id: task.id,
      taskId: task.id,
      eventId,
      calendarId: 'primary',
      payloadHash: hash,
      updatedAt: Date.now(),
      deletedAt: null,
      syncState: 'dirty',
    });
    await setTaskEvent(task, eventId);
    if (link) result.updated++;
    else result.created++;
  }
  return result;
}
