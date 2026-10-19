// Deno entry point for the send-reminders Edge Function.
// Secrets: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com).
// Deploy with --no-verify-jwt: only pg_cron calls it, authenticated by CRON_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { createReminderHandler, type ReminderTarget } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const ms = (v: string | null) => (v ? new Date(v).getTime() : undefined);

Deno.serve(
  createReminderHandler({
    now: () => Date.now(),
    cronSecret: Deno.env.get('CRON_SECRET') ?? '',
    vapid: {
      publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
      subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    },
    fetch,

    async listTargets() {
      const { data: subs, error } = await admin.from('push_subscriptions').select('user_id, endpoint, p256dh, auth');
      if (error) throw error;
      const userIds = [...new Set((subs ?? []).map((s) => s.user_id as string))];
      if (!userIds.length) return [];

      const { data: profiles } = await admin
        .from('profiles')
        .select('id, timezone, reminders_enabled, reminder_lead_min, push_morning, push_morning_time, push_deadlines, push_evening, push_evening_time')
        .in('id', userIds)
        .eq('reminders_enabled', true);
      const enabled = new Map((profiles ?? []).map((p) => [p.id as string, p]));
      if (!enabled.size) return [];

      const ids = [...enabled.keys()];
      const taskColumns = 'user_id, id, title, status, blocks, fixed_start, fixed_end, due_at, completed_at';
      const { data: open } = await admin.from('tasks').select(taskColumns).in('user_id', ids).in('status', ['todo', 'scheduled', 'doing']).is('deleted_at', null);
      // finished in the last two days: the evening wrap-up counts what got done today
      const { data: finished } = await admin
        .from('tasks')
        .select(taskColumns)
        .in('user_id', ids)
        .eq('status', 'done')
        .gte('completed_at', new Date(Date.now() - 2 * 86_400_000).toISOString())
        .is('deleted_at', null);
      const tasks = [...(open ?? []), ...(finished ?? [])];

      return [...enabled.values()].map(
        (p): ReminderTarget => ({
          userId: p.id,
          timezone: p.timezone,
          leadMin: p.reminder_lead_min ?? 5,
          prefs: {
            morning: p.push_morning ?? true,
            morningTime: p.push_morning_time ?? '08:00',
            deadlines: p.push_deadlines ?? true,
            evening: p.push_evening ?? true,
            eveningTime: p.push_evening_time ?? '20:30',
          },
          subscriptions: (subs ?? []).filter((s) => s.user_id === p.id).map((s) => ({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
          tasks: (tasks ?? [])
            .filter((t) => t.user_id === p.id)
            .map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              blocks: (t.blocks ?? []) as ReminderTarget['tasks'][number]['blocks'],
              fixedStart: ms(t.fixed_start),
              fixedEnd: ms(t.fixed_end),
              dueAt: ms(t.due_at),
              completedAt: ms(t.completed_at),
            })),
        }),
      );
    },

    async sentKeys(userId, keys) {
      const { data } = await admin.from('reminders_sent').select('block_id').eq('user_id', userId).in('block_id', keys);
      return new Set((data ?? []).map((r) => r.block_id as string));
    },

    async markSent(userId, keys) {
      await admin.from('reminders_sent').upsert(keys.map((block_id) => ({ user_id: userId, block_id })), { onConflict: 'user_id,block_id' });
      // keep the table small
      await admin.from('reminders_sent').delete().lt('sent_at', new Date(Date.now() - 3 * 86_400_000).toISOString());
    },

    async removeSubscription(endpoint) {
      await admin.from('push_subscriptions').delete().eq('endpoint', endpoint);
    },
  }),
);
