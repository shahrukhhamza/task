// Push reminders shortly before each planned block, even when Dayflow is closed.
// Called by pg_cron every minute with the x-cron-secret header.

import { corsHeaders, json, safeEqual } from '../_shared/http.ts';
import { sendPush, type PushSubscriptionKeys, type VapidKeys } from '../_shared/webpush.ts';
import { dueReminders, reminderPayload, type ReminderTask } from '../_shared/reminders.ts';

export { dueReminders, reminderPayload };

export interface ReminderTarget {
  userId: string;
  timezone: string;
  leadMin: number;
  subscriptions: PushSubscriptionKeys[];
  tasks: ReminderTask[];
}

export interface ReminderDeps {
  now(): number;
  cronSecret: string;
  vapid: VapidKeys;
  fetch: typeof fetch;
  listTargets(): Promise<ReminderTarget[]>;
  /** Which of these reminder keys were already sent to the user. */
  sentKeys(userId: string, keys: string[]): Promise<Set<string>>;
  markSent(userId: string, keys: string[]): Promise<void>;
  removeSubscription(endpoint: string): Promise<void>;
}

export function createReminderHandler(deps: ReminderDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    const secret = req.headers.get('x-cron-secret') ?? '';
    if (!deps.cronSecret || !safeEqual(secret, deps.cronSecret)) return json({ error: 'unauthorized' }, 401);
    if (!deps.vapid.publicKey || !deps.vapid.privateKey) return json({ error: 'not_configured', message: 'VAPID keys are missing.' }, 503);

    const now = deps.now();
    const result = { sent: 0, gone: 0, failed: 0 };
    for (const target of await deps.listTargets()) {
      if (!target.subscriptions.length) continue;
      const due = dueReminders(target, now);
      if (!due.length) continue;
      const already = await deps.sentKeys(target.userId, due.map((d) => d.key));
      const fresh = due.filter((d) => !already.has(d.key));
      if (!fresh.length) continue;

      for (const reminder of fresh) {
        const payload = reminderPayload(reminder, target.timezone, now);
        for (const sub of target.subscriptions) {
          try {
            const { outcome } = await sendPush(deps.fetch, sub, payload, deps.vapid);
            result[outcome]++;
            if (outcome === 'gone') await deps.removeSubscription(sub.endpoint);
          } catch {
            result.failed++;
          }
        }
      }
      // marked even if one device failed, so a broken subscription can't cause repeats
      await deps.markSent(target.userId, fresh.map((f) => f.key));
    }
    return json(result);
  };
}
