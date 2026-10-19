import { describe, expect, it } from 'vitest';
import { createPushTestHandler } from '../supabase/functions/push-test/handler.ts';
import { createReminderHandler, type ReminderTarget } from '../supabase/functions/send-reminders/handler.ts';
import { deadlineNotices, dueNotices, eveningNotice, morningNotice, type PushPrefs, type ReminderTask } from '../supabase/functions/_shared/reminders.ts';
import { bytesToB64url } from '../supabase/functions/_shared/webpush.ts';
import { endOfDayTz } from '../src/lib/time/tz';
import { TZ, at } from './helpers';

const task = (over: Partial<ReminderTask> & { id: string; title: string }): ReminderTask => ({ status: 'todo', blocks: [], ...over });
const MIN = 60_000;

const PREFS: PushPrefs = { morning: true, morningTime: '08:00', deadlines: true, evening: true, eveningTime: '20:30' };
const MORNING = at(10, 19, 8, 10);
const EVENING = at(10, 19, 20, 40);

const day = [
  task({ id: 'a', title: 'Dentist', status: 'scheduled', fixedStart: at(10, 19, 9), fixedEnd: at(10, 19, 10) }),
  // planned in two chunks: still one thing
  task({ id: 'b', title: 'Essay', status: 'scheduled', blocks: [{ id: 'b:1', start: at(10, 19, 10), end: at(10, 19, 11) }, { id: 'b:2', start: at(10, 19, 14), end: at(10, 19, 15) }] }),
  task({ id: 'c', title: 'Report', dueAt: endOfDayTz(at(10, 19, 12), TZ) }),
  task({ id: 'd', title: 'Next week', status: 'scheduled', blocks: [{ id: 'd:1', start: at(10, 26, 10), end: at(10, 26, 11) }] }),
];

describe('morning plan', () => {
  it('counts what is planned today and names the first thing and the deadlines', () => {
    expect(morningNotice(day, TZ, MORNING)).toEqual({
      key: 'morning:2026-10-19',
      title: 'Today: 3 things planned',
      body: 'First up: Dentist at 9:00 AM · Due today: Report',
      tag: 'morning:2026-10-19',
      url: '/',
    });
  });

  it('says nothing on an empty day', () => {
    expect(morningNotice([day[3]], TZ, MORNING)).toBeNull();
    expect(morningNotice([], TZ, MORNING)).toBeNull();
  });

  it('ignores finished and deleted tasks', () => {
    const tasks = [task({ id: 'x', title: 'Done already', status: 'done', fixedStart: at(10, 19, 9) }), task({ id: 'y', title: 'Gone', fixedStart: at(10, 19, 9), deletedAt: 1 })];
    expect(morningNotice(tasks, TZ, MORNING)).toBeNull();
  });
});

describe('deadline alerts', () => {
  const now = at(10, 19, 15, 0);
  const due = (minutes: number) => task({ id: `t${minutes}`, title: `Task ${minutes}`, dueAt: now + minutes * MIN });

  it('alerts an hour before a deadline with a set time', () => {
    const [n] = deadlineNotices([due(45)], TZ, now);
    expect(n.title).toBe('Due in 45 min: Task 45');
    expect(n.body).toBe('Deadline at 3:45 PM. Open Dayflow to finish it or move it.');
    expect(n.key).toBe(`due:t45:${now + 45 * MIN}`);
  });

  it('waits until the hour is near, and skips passed deadlines', () => {
    expect(deadlineNotices([due(180), due(-5)], TZ, now)).toEqual([]);
  });

  it('leaves date-only deadlines to the morning plan', () => {
    expect(deadlineNotices([task({ id: 'e', title: 'End of day', dueAt: endOfDayTz(now, TZ) })], TZ, endOfDayTz(now, TZ) - 30 * MIN)).toEqual([]);
  });

  it('skips tasks that are already done', () => {
    expect(deadlineNotices([{ ...due(30), status: 'done' }], TZ, now)).toEqual([]);
  });
});

describe('evening wrap-up', () => {
  const finished = (id: string, hour: number) => task({ id, title: `Finished ${id}`, status: 'done', completedAt: at(10, 19, hour) });
  const tomorrow = task({ id: 'g', title: 'Gym', status: 'scheduled', fixedStart: at(10, 20, 7), fixedEnd: at(10, 20, 8) });
  const open = task({ id: 'o', title: 'Read', status: 'scheduled', blocks: [{ id: 'o:1', start: at(10, 19, 21), end: at(10, 19, 22) }] });

  it('sums up the day and previews tomorrow', () => {
    expect(eveningNotice([finished('1', 9), finished('2', 13), open, tomorrow], TZ, EVENING)).toMatchObject({
      key: 'evening:2026-10-19',
      title: 'Wrapping up the day',
      body: '2 done, 1 still open · Tomorrow starts with Gym at 7:00 AM',
    });
  });

  it('congratulates a finished day', () => {
    expect(eveningNotice([finished('1', 9), finished('2', 13), tomorrow], TZ, EVENING)).toMatchObject({
      title: 'Nice work today',
      body: 'All done: 2 tasks finished today · Tomorrow starts with Gym at 7:00 AM',
    });
  });

  it('only counts what finished today', () => {
    const yesterday = task({ id: 'y', title: 'Old', status: 'done', completedAt: at(10, 18, 15) });
    expect(eveningNotice([yesterday], TZ, EVENING)).toBeNull();
  });
});

describe('which notices are due now', () => {
  const target = (prefs: Partial<PushPrefs>) => ({ timezone: TZ, tasks: day, prefs });

  it('sends the morning plan inside its half hour only', () => {
    expect(dueNotices(target(PREFS), at(10, 19, 7, 59)).map((n) => n.key)).toEqual([]);
    expect(dueNotices(target(PREFS), at(10, 19, 8, 0)).map((n) => n.key)).toEqual(['morning:2026-10-19']);
    expect(dueNotices(target(PREFS), at(10, 19, 8, 29)).map((n) => n.key)).toEqual(['morning:2026-10-19']);
    expect(dueNotices(target(PREFS), at(10, 19, 8, 31)).map((n) => n.key)).toEqual([]);
  });

  it('honours each switch and the chosen times', () => {
    expect(dueNotices(target({ ...PREFS, morning: false }), MORNING)).toEqual([]);
    expect(dueNotices(target({ ...PREFS, morningTime: '06:30' }), at(10, 19, 6, 40)).map((n) => n.key)).toEqual(['morning:2026-10-19']);
    expect(dueNotices(target({ ...PREFS, evening: false }), EVENING)).toEqual([]);
    expect(dueNotices(target({}), MORNING)).toEqual([]);
  });

  it('follows the user’s timezone, not the server’s', () => {
    // 08:10 in Karachi is 03:10 UTC; in New York the same instant is 23:10 the night before
    expect(dueNotices({ timezone: 'America/New_York', tasks: day, prefs: PREFS }, MORNING)).toEqual([]);
  });
});

describe('send-reminders with the new notifications', () => {
  async function setup(targets: ReminderTarget[], now: number) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    const sent = new Map<string, Set<string>>();
    const bodies: string[] = [];
    const handle = createReminderHandler({
      now: () => now,
      cronSecret: 's3cret',
      vapid: {
        publicKey: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
        privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d as string,
        subject: 'mailto:me@example.com',
      },
      fetch: (async (url: string) => {
        bodies.push(url);
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
      listTargets: async () => targets,
      sentKeys: async (u, keys) => new Set(keys.filter((k) => sent.get(u)?.has(k))),
      markSent: async (u, keys) => void sent.set(u, new Set([...(sent.get(u) ?? []), ...keys])),
      removeSubscription: async () => {},
    });
    const call = async () => (await handle(new Request('https://fn', { method: 'POST', headers: { 'x-cron-secret': 's3cret' } }))).json();
    return { call, bodies, sent };
  }

  const sub = { endpoint: 'https://push.example/1', p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  const user = (over: Partial<ReminderTarget> = {}): ReminderTarget => ({ userId: 'u1', timezone: TZ, leadMin: 5, subscriptions: [sub], tasks: day, prefs: PREFS, ...over });

  it('pushes the morning plan once per day', async () => {
    const { call, sent } = await setup([user()], MORNING);
    expect(await call()).toEqual({ sent: 1, gone: 0, failed: 0 });
    expect(await call()).toEqual({ sent: 0, gone: 0, failed: 0 });
    expect([...(sent.get('u1') ?? [])]).toEqual(['morning:2026-10-19']);
  });

  it('keeps working for users who never set preferences', async () => {
    const { call } = await setup([user({ prefs: undefined })], MORNING);
    expect(await call()).toEqual({ sent: 0, gone: 0, failed: 0 });
  });

  it('sends a reminder and a deadline alert together, once each', async () => {
    const now = at(10, 19, 14, 0);
    const tasks = [...day, task({ id: 'z', title: 'Submit form', dueAt: now + 40 * MIN })];
    const { call, sent } = await setup([user({ tasks })], now);
    // Essay's second chunk starts at 14:00 sharp (not in the future), so only the deadline goes out here
    expect((await call()).sent).toBe(1);
    expect([...(sent.get('u1') ?? [])].some((k) => k.startsWith('due:z:'))).toBe(true);
  });
});

describe('push-test function', () => {
  const sub = { endpoint: 'https://push.example/1', p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };

  async function setup(opts: { subs?: typeof sub[]; user?: string | null; status?: number; configured?: boolean } = {}) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    let clock = 1_000_000;
    const removed: string[] = [];
    const handler = createPushTestHandler({
      now: () => clock,
      vapid:
        opts.configured === false
          ? { publicKey: '', privateKey: '', subject: 'mailto:me@example.com' }
          : {
              publicKey: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
              privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d as string,
              subject: 'mailto:me@example.com',
            },
      fetch: (async () => new Response(null, { status: opts.status ?? 201 })) as unknown as typeof fetch,
      authenticate: async () => (opts.user === undefined ? 'u1' : opts.user),
      listSubscriptions: async () => opts.subs ?? [sub],
      removeSubscription: async (e) => void removed.push(e),
    });
    const call = () => handler(new Request('https://fn', { method: 'POST' }));
    return { call, removed, advance: (ms: number) => void (clock += ms) };
  }

  it('sends a test to every registered device', async () => {
    const { call } = await setup({ subs: [sub, { ...sub, endpoint: 'https://push.example/2' }] });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 2, gone: 0, failed: 0, devices: 2 });
  });

  it('needs a signed-in user', async () => {
    expect((await (await setup({ user: null })).call()).status).toBe(401);
  });

  it('explains when push is not configured or no device is registered', async () => {
    expect((await (await setup({ configured: false })).call()).status).toBe(503);
    const none = await (await setup({ subs: [] })).call();
    expect(none.status).toBe(409);
    expect((await none.json()).error).toBe('no_device');
  });

  it('rate limits repeated tests and lets them through again later', async () => {
    const { call, advance } = await setup();
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
    advance(6_000);
    expect((await call()).status).toBe(200);
  });

  it('forgets devices the push service says are gone', async () => {
    const { call, removed } = await setup({ status: 410 });
    expect((await (await call()).json()).gone).toBe(1);
    expect(removed).toEqual([sub.endpoint]);
  });
});
