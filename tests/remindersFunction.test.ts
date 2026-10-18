import { describe, expect, it } from 'vitest';
import { createReminderHandler, dueReminders, reminderPayload, type ReminderTarget } from '../supabase/functions/send-reminders/handler.ts';
import { bytesToB64url } from '../supabase/functions/_shared/webpush.ts';
import { NOW, TZ, at } from './helpers';

const target = (over: Partial<ReminderTarget> = {}): ReminderTarget => ({
  userId: 'u1',
  timezone: TZ,
  leadMin: 5,
  subscriptions: [{ endpoint: 'https://push.example/1', p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }],
  tasks: [
    { id: 'a', title: 'Essay', status: 'scheduled', blocks: [{ id: 'a:1', start: NOW + 4 * 60_000, end: NOW + 64 * 60_000 }] },
    { id: 'b', title: 'Later', status: 'scheduled', blocks: [{ id: 'b:1', start: NOW + 30 * 60_000, end: NOW + 60 * 60_000 }] },
    { id: 'c', title: 'Started', status: 'doing', blocks: [{ id: 'c:1', start: NOW - 60_000, end: NOW + 30 * 60_000 }] },
    { id: 'd', title: 'Done', status: 'done', blocks: [{ id: 'd:1', start: NOW + 2 * 60_000, end: NOW + 30 * 60_000 }] },
    { id: 'e', title: 'Dentist', status: 'todo', blocks: [], fixedStart: NOW + 6 * 60_000, fixedEnd: NOW + 66 * 60_000 },
  ],
  ...over,
});

describe('which reminders are due', () => {
  it('picks blocks and appointments starting within the lead time', () => {
    expect(dueReminders(target(), NOW).map((r) => r.title)).toEqual(['Essay', 'Dentist']);
  });

  it('builds a readable notification', () => {
    const [first] = dueReminders(target(), at(10, 19, 10));
    expect(reminderPayload(first, TZ, NOW)).toEqual({
      title: 'Up next: Essay',
      body: '10:04 AM – 11:04 AM · 1h · starts in 4 min',
      tag: 'a:1',
      url: '/',
    });
  });
});

describe('send-reminders function', () => {
  async function setup(targets: ReminderTarget[], status = 201) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    const sent = new Map<string, Set<string>>();
    const removed: string[] = [];
    const pushes: string[] = [];
    const handle = createReminderHandler({
      now: () => NOW,
      cronSecret: 's3cret',
      vapid: {
        publicKey: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
        privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d as string,
        subject: 'mailto:me@example.com',
      },
      fetch: (async (url: string) => {
        pushes.push(url);
        return new Response(null, { status });
      }) as unknown as typeof fetch,
      listTargets: async () => targets,
      sentKeys: async (u, keys) => new Set(keys.filter((k) => sent.get(u)?.has(k))),
      markSent: async (u, keys) => void sent.set(u, new Set([...(sent.get(u) ?? []), ...keys])),
      removeSubscription: async (e) => void removed.push(e),
    });
    const call = (secret = 's3cret') => handle(new Request('https://fn', { method: 'POST', headers: { 'x-cron-secret': secret } }));
    return { call, pushes, removed };
  }

  it('requires the cron secret', async () => {
    const { call } = await setup([target()]);
    expect((await call('wrong')).status).toBe(401);
  });

  it('sends each reminder once', async () => {
    const { call, pushes } = await setup([target()]);
    expect(await (await call()).json()).toEqual({ sent: 2, gone: 0, failed: 0 });
    expect(await (await call()).json()).toEqual({ sent: 0, gone: 0, failed: 0 });
    expect(pushes).toHaveLength(2);
  });

  it('cleans up expired subscriptions', async () => {
    const { call, removed } = await setup([target()], 410);
    expect((await (await call()).json()).gone).toBe(2);
    expect(removed).toContain('https://push.example/1');
  });
});
