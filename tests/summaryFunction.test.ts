import { beforeEach, describe, expect, it } from 'vitest';
import { createSummaryHandler, isDue, unsubscribeUrl, type EmailKind, type ProfileRow, type SummaryDeps, type UserData } from '../supabase/functions/daily-summary/handler.ts';
import { TZ, at, makeTask } from './helpers';

const profile = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  id: 'u1',
  timezone: TZ,
  peak_start: 540,
  peak_end: 720,
  email_enabled: true,
  email_time: '21:30',
  email_recipient: 'me@example.com',
  email_weekly: true,
  ...over,
});

let now: number;
let profiles: ProfileRow[];
let sent: Array<{ to: string; subject: string; html: string; headers: Record<string, string> }>;
let logs: Array<{ userId: string; kind: EmailKind; forDate: string; status: string; error?: string }>;
let disabled: string[];
let failFor: Set<string>;
let handle: (req: Request) => Promise<Response>;
let deps: SummaryDeps;

const data = (): UserData => ({
  tasks: [makeTask({ id: 't', title: 'Essay', status: 'done', completedAt: at(10, 18, 11), estimateMin: 60, spentMin: 75 })],
  events: [],
  fixed: [],
  checkins: [],
  habits: [],
  habitLogs: [],
});

beforeEach(() => {
  now = at(10, 18, 21, 45); // Sunday 18 Oct, 9:45 PM in Karachi
  profiles = [profile()];
  sent = [];
  logs = [];
  disabled = [];
  failFor = new Set();
  deps = {
    now: () => now,
    cronSecret: 'cron-secret',
    unsubscribeSecret: 'unsub-secret',
    appUrl: 'https://dayflow.app',
    functionUrl: 'https://proj.supabase.co/functions/v1/daily-summary',
    authenticate: async (req) => req.headers.get('Authorization')?.replace('Bearer ', '') ?? null,
    listEnabledProfiles: async () => profiles.filter((p) => p.email_enabled),
    getProfile: async (id) => profiles.find((p) => p.id === id) ?? null,
    loadUserData: async () => data(),
    hasSent: async (userId, kind, date) => logs.some((l) => l.userId === userId && l.kind === kind && l.forDate === date && l.status === 'sent'),
    countTestsSince: async (userId) => logs.filter((l) => l.userId === userId && l.kind === 'test').length,
    log: async (entry) => void logs.push(entry),
    send: async (msg) => {
      if (failFor.has(msg.to)) throw new Error('mailbox unavailable');
      sent.push(msg);
      return { id: `msg-${sent.length}` };
    },
    disableEmails: async (id) => void disabled.push(id),
  };
  handle = createSummaryHandler(deps);
});

const cron = (secret = 'cron-secret') =>
  handle(new Request('https://fn/daily-summary', { method: 'POST', headers: { 'x-cron-secret': secret }, body: '{}' }));

const asUser = (user: string, body: unknown) =>
  handle(new Request('https://fn/daily-summary', { method: 'POST', headers: { Authorization: `Bearer ${user}` }, body: JSON.stringify(body) }));

describe('scheduling', () => {
  it('is due once the local send time has passed', () => {
    expect(isDue({ timezone: TZ, email_time: '21:30' }, at(10, 18, 21, 29))).toBe(false);
    expect(isDue({ timezone: TZ, email_time: '21:30' }, at(10, 18, 21, 30))).toBe(true);
    // 21:45 in Karachi is only 12:45 in London
    expect(isDue({ timezone: 'Europe/London', email_time: '21:30' }, at(10, 18, 21, 45))).toBe(false);
  });

  it('rejects cron calls with the wrong secret', async () => {
    expect((await cron('nope')).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('sends the daily email, plus the weekly one on Sundays, exactly once', async () => {
    const first = await (await cron()).json();
    expect(first).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(sent.map((m) => m.subject)).toEqual([expect.stringMatching(/^Your day: 100% · 1 of 1 done$/), expect.stringMatching(/^Your week/)]);

    const second = await (await cron()).json();
    expect(second.sent).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('sends only the daily email on other days', async () => {
    now = at(10, 19, 21, 45); // Monday
    await cron();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^Your day/);
  });

  it('skips users whose time hasn’t come, who opted out or have no address', async () => {
    profiles = [
      profile({ id: 'early', email_time: '23:00' }),
      profile({ id: 'off', email_enabled: false }),
      profile({ id: 'blank', email_recipient: '' }),
      profile({ id: 'weekly-off', email_weekly: false, email_recipient: 'w@example.com' }),
    ];
    const result = await (await cron()).json();
    expect(sent.map((m) => m.to)).toEqual(['w@example.com']);
    expect(result.sent).toBe(1);
  });

  it('keeps going when one recipient fails, and logs the failure', async () => {
    profiles = [profile({ id: 'bad', email_recipient: 'bad@example.com', email_weekly: false }), profile({ id: 'good', email_recipient: 'good@example.com', email_weekly: false })];
    failFor.add('bad@example.com');
    const result = await (await cron()).json();
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(logs.find((l) => l.userId === 'bad')).toMatchObject({ status: 'failed', error: 'mailbox unavailable' });
    // a failed send is retried on the next run
    failFor.clear();
    await cron();
    expect(sent.map((m) => m.to)).toContain('bad@example.com');
  });

  it('adds one-click unsubscribe headers', async () => {
    await cron();
    const url = await unsubscribeUrl(deps, 'u1');
    expect(sent[0].headers).toEqual({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(sent[0].html).toContain(url.replace(/&/g, '&amp;'));
  });
});

describe('test email', () => {
  it('requires sign-in and an address', async () => {
    expect((await handle(new Request('https://fn', { method: 'POST', body: '{"action":"test"}' }))).status).toBe(401);
    profiles = [profile({ email_recipient: '' })];
    expect((await asUser('u1', { action: 'test' })).status).toBe(400);
  });

  it('sends right away and is rate limited', async () => {
    const res = await asUser('u1', { action: 'test' });
    expect(await res.json()).toMatchObject({ ok: true, to: 'me@example.com' });
    expect(logs[0]).toMatchObject({ kind: 'test', status: 'sent' });
    for (let i = 0; i < 4; i++) await asUser('u1', { action: 'test' });
    expect((await asUser('u1', { action: 'test' })).status).toBe(429);
  });

  it('can preview the weekly email', async () => {
    await asUser('u1', { action: 'test', weekly: true });
    expect(sent[0].subject).toMatch(/^Your week/);
  });
});

describe('unsubscribe', () => {
  it('turns emails off with a valid link', async () => {
    const res = await handle(new Request(await unsubscribeUrl(deps, 'u1')));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('You’re unsubscribed');
    expect(disabled).toEqual(['u1']);
  });

  it('supports one-click POST from mail clients', async () => {
    const res = await handle(new Request(await unsubscribeUrl(deps, 'u1'), { method: 'POST', body: 'List-Unsubscribe=One-Click' }));
    expect(res.status).toBe(200);
    expect(disabled).toEqual(['u1']);
  });

  it('rejects forged or swapped links', async () => {
    const url = new URL(await unsubscribeUrl(deps, 'u1'));
    url.searchParams.set('u', 'someone-else');
    expect((await handle(new Request(url))).status).toBe(400);
    expect((await handle(new Request('https://fn?action=unsubscribe&u=u1&t=garbage'))).status).toBe(400);
    expect(disabled).toEqual([]);
  });
});
