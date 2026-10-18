import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { eventTiming, googleEventId, googleEventPayload, googleTemplateUrl, payloadHash, recurrenceToRrule } from '../src/lib/calendar/event';
import { importGoogleEvents, syncCalendarLinks, type Invoke } from '../src/lib/calendar/googleSync';
import { buildIcs } from '../src/lib/calendar/ics';
import { DayflowDB } from '../src/lib/db/schema';
import { endOfDayTz } from '../src/lib/time/tz';
import { NOW, TZ, at, makeTask } from './helpers';

const dbs: DayflowDB[] = [];
const freshDb = () => {
  const d = new DayflowDB(`cal-${Math.random()}`);
  dbs.push(d);
  return d;
};
afterEach(async () => {
  for (const d of dbs.splice(0)) await d.delete();
});

const UUID = '3f2a9c1e-7b4d-4e8a-9f10-2b3c4d5e6f70';

describe('event timing', () => {
  it('uses fixed times, then the first block, then the deadline', () => {
    expect(eventTiming(makeTask({ fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) }))).toMatchObject({ start: at(10, 23, 16), allDay: false, isDeadline: false });
    const blocks = [
      { id: 'b2', taskId: 't', start: at(10, 20, 9), end: at(10, 20, 10), chunk: 2, chunks: 2 },
      { id: 'b1', taskId: 't', start: at(10, 19, 9), end: at(10, 19, 10), chunk: 1, chunks: 2 },
    ];
    expect(eventTiming(makeTask({ blocks }))?.start).toBe(at(10, 19, 9));
    expect(eventTiming(makeTask({ dueAt: endOfDayTz(at(10, 22, 12), TZ) }))).toMatchObject({ allDay: true, isDeadline: true });
    expect(eventTiming(makeTask({ dueAt: at(10, 22, 17) }))).toMatchObject({ start: at(10, 22, 16, 45), allDay: false, isDeadline: true });
    expect(eventTiming(makeTask({}))).toBeNull();
  });

  it('turns recurrence into RRULEs', () => {
    expect(recurrenceToRrule({ freq: 'weekly', interval: 1, byDay: [1, 3] })).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
    expect(recurrenceToRrule({ freq: 'daily', interval: 3 })).toBe('RRULE:FREQ=DAILY;INTERVAL=3');
    expect(recurrenceToRrule({ freq: 'monthly', interval: 1 })).toBe('RRULE:FREQ=MONTHLY');
  });

  it('builds stable Google event ids from task ids', () => {
    const id = googleEventId(UUID);
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(googleEventId(UUID)).toBe(id);
    expect(googleEventId('short')).toMatch(/^[0-9a-v]+$/);
  });
});

describe('google payload', () => {
  it('includes the zone, the deadline prefix and a back-reference to the task', () => {
    const appt = googleEventPayload(makeTask({ id: UUID, title: 'Dentist', fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) }), TZ);
    expect(appt).toMatchObject({
      summary: 'Dentist',
      start: { dateTime: new Date(at(10, 23, 16)).toISOString(), timeZone: TZ },
      extendedProperties: { private: { dayflow: '1', dayflowTaskId: UUID } },
    });
    const due = googleEventPayload(makeTask({ title: 'Essay', dueAt: endOfDayTz(at(10, 22, 12), TZ) }), TZ);
    expect(due).toMatchObject({ summary: 'Due: Essay', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } });
  });

  it('changes hash only when the event changes', () => {
    const t = makeTask({ fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) });
    const a = payloadHash(googleEventPayload(t, TZ));
    expect(payloadHash(googleEventPayload({ ...t }, TZ))).toBe(a);
    expect(payloadHash(googleEventPayload({ ...t, fixedStart: at(10, 23, 15) }, TZ))).not.toBe(a);
  });

  it('builds a no-login template link', () => {
    const url = new URL(googleTemplateUrl(makeTask({ title: 'Gym', fixedStart: at(10, 19, 18), fixedEnd: at(10, 19, 19), recurrence: { freq: 'weekly', interval: 1, byDay: [1] } }), TZ)!);
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Gym');
    expect(url.searchParams.get('dates')).toBe('20261019T130000Z/20261019T140000Z');
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(url.searchParams.get('ctz')).toBe(TZ);
  });
});

describe('.ics export', () => {
  it('writes a valid calendar with UTC, all-day and local repeating events', () => {
    const ics = buildIcs(
      [
        makeTask({ id: 'a', title: 'Dentist, Dr. Khan; room 4', fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) }),
        makeTask({ id: 'b', title: 'Essay', dueAt: endOfDayTz(at(10, 22, 12), TZ) }),
        makeTask({ id: 'c', title: 'Gym', fixedStart: at(10, 19, 18), fixedEnd: at(10, 19, 19), recurrence: { freq: 'weekly', interval: 1, byDay: [1, 3] } }),
        makeTask({ id: 'd', title: 'Unplanned' }),
      ],
      TZ,
      NOW,
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('DTSTART:20261023T110000Z');
    expect(ics).toContain('SUMMARY:Dentist\\, Dr. Khan\\; room 4');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261022');
    expect(ics).toContain('DTEND;VALUE=DATE:20261023');
    expect(ics).toContain(`DTSTART;TZID=${TZ}:20261019T180000`);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
    expect(ics).not.toContain('Unplanned');
    expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });

  it('folds long lines', () => {
    const ics = buildIcs([makeTask({ title: 'x'.repeat(200), fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) })], TZ, NOW);
    expect(ics).toContain('\r\n x');
  });
});

/** In-memory stand-in for the google-calendar Edge Function. */
function fakeCalendar(events: Array<Record<string, unknown>> = []) {
  const store = new Map<string, Record<string, unknown>>();
  const calls: Array<Record<string, unknown>> = [];
  const invoke: Invoke = async (body) => {
    calls.push(body);
    if (body.action === 'list') return { events } as never;
    if (body.action === 'upsert') {
      const id = (body.eventId as string) ?? `e${store.size}`;
      store.set(id, body.event as Record<string, unknown>);
      return { eventId: id } as never;
    }
    if (body.action === 'delete') {
      store.delete(body.eventId as string);
      return { ok: true } as never;
    }
    throw new Error('unexpected');
  };
  return { invoke, store, calls };
}

describe('importing Google events', () => {
  const ev = (id: string, start: number, end: number, extra = {}) => ({ id, title: id, start, end, allDay: false, transparent: false, declined: false, fromDayflow: false, ...extra });

  it('imports busy events and skips all-day, free, declined and Dayflow ones', async () => {
    const db = freshDb();
    const cal = fakeCalendar([
      ev('standup', at(10, 19, 9), at(10, 19, 9, 15)),
      ev('holiday', at(10, 19, 0), at(10, 20, 0), { allDay: true }),
      ev('lunch', at(10, 19, 13), at(10, 19, 14), { transparent: true }),
      ev('skip', at(10, 19, 15), at(10, 19, 16), { declined: true }),
      ev('mine', at(10, 19, 16), at(10, 19, 17), { fromDayflow: true }),
    ]);
    const result = await importGoogleEvents(cal.invoke, db, NOW, TZ);
    expect(result).toEqual({ added: 1, updated: 0, removed: 0 });
    const rows = await db.fixedEvents.toArray();
    expect(rows.map((r) => r.id)).toEqual(['google:standup']);
    expect(rows[0]).toMatchObject({ source: 'google', externalId: 'standup', syncState: 'dirty' });
  });

  it('updates moved events and removes ones that disappeared', async () => {
    const db = freshDb();
    await importGoogleEvents(fakeCalendar([ev('a', at(10, 19, 9), at(10, 19, 10)), ev('b', at(10, 20, 9), at(10, 20, 10))]).invoke, db, NOW, TZ);
    const second = await importGoogleEvents(fakeCalendar([ev('a', at(10, 19, 11), at(10, 19, 12))]).invoke, db, NOW, TZ);
    expect(second).toEqual({ added: 0, updated: 1, removed: 1 });
    expect((await db.fixedEvents.get('google:a'))?.start).toBe(at(10, 19, 11));
    expect((await db.fixedEvents.get('google:b'))?.deletedAt).toBeTruthy();
  });

  it('asks for the right window', async () => {
    const db = freshDb();
    const cal = fakeCalendar();
    await importGoogleEvents(cal.invoke, db, NOW, TZ);
    expect(cal.calls[0]).toMatchObject({ action: 'list', timeMin: new Date(at(10, 19)).toISOString(), timeMax: new Date(at(11, 2)).toISOString() });
  });
});

describe('writing tasks to Google', () => {
  it('creates an event for a flagged task and remembers the mapping', async () => {
    const db = freshDb();
    const cal = fakeCalendar();
    await db.tasks.put(makeTask({ id: UUID, title: 'Dentist', addToCalendar: true, fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) }));
    expect(await syncCalendarLinks(cal.invoke, db, TZ)).toEqual({ created: 1, updated: 0, deleted: 0 });
    const link = await db.calendarLinks.get(UUID);
    expect(link?.eventId).toBe(googleEventId(UUID));
    expect((await db.tasks.get(UUID))?.calendarEventId).toBe(link?.eventId);
    expect(cal.store.get(link!.eventId)).toMatchObject({ summary: 'Dentist' });
  });

  it('does nothing when nothing changed, updates when the task moves', async () => {
    const db = freshDb();
    const cal = fakeCalendar();
    await db.tasks.put(makeTask({ id: UUID, addToCalendar: true, fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) }));
    await syncCalendarLinks(cal.invoke, db, TZ);
    expect(await syncCalendarLinks(cal.invoke, db, TZ)).toEqual({ created: 0, updated: 0, deleted: 0 });
    await db.tasks.update(UUID, { fixedStart: at(10, 23, 18), fixedEnd: at(10, 23, 19) });
    expect(await syncCalendarLinks(cal.invoke, db, TZ)).toEqual({ created: 0, updated: 1, deleted: 0 });
  });

  it('deletes the event when the task is deleted or unflagged', async () => {
    const db = freshDb();
    const cal = fakeCalendar();
    await db.tasks.bulkPut([
      makeTask({ id: 'aaaaaaaa-0000-0000-0000-000000000001', addToCalendar: true, fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17) }),
      makeTask({ id: 'aaaaaaaa-0000-0000-0000-000000000002', addToCalendar: true, fixedStart: at(10, 24, 16), fixedEnd: at(10, 24, 17) }),
    ]);
    await syncCalendarLinks(cal.invoke, db, TZ);
    expect(cal.store.size).toBe(2);
    await db.tasks.update('aaaaaaaa-0000-0000-0000-000000000001', { deletedAt: NOW });
    await db.tasks.update('aaaaaaaa-0000-0000-0000-000000000002', { addToCalendar: false });
    expect(await syncCalendarLinks(cal.invoke, db, TZ)).toEqual({ created: 0, updated: 0, deleted: 2 });
    expect(cal.store.size).toBe(0);
    expect((await db.calendarLinks.toArray()).every((l) => l.deletedAt)).toBe(true);
  });

  it('waits for a flexible task to be planned before adding it', async () => {
    const db = freshDb();
    const cal = fakeCalendar();
    await db.tasks.put(makeTask({ id: UUID, addToCalendar: true }));
    expect(await syncCalendarLinks(cal.invoke, db, TZ)).toEqual({ created: 0, updated: 0, deleted: 0 });
    await db.tasks.update(UUID, { blocks: [{ id: 'b', taskId: UUID, start: at(10, 19, 9), end: at(10, 19, 10), chunk: 1, chunks: 1 }] });
    expect((await syncCalendarLinks(cal.invoke, db, TZ)).created).toBe(1);
  });
});
