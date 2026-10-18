// Deno entry point for the daily-summary Edge Function.
// Secrets: RESEND_API_KEY, CRON_SECRET, UNSUBSCRIBE_SECRET, APP_URL, and optionally EMAIL_FROM.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Deploy with --no-verify-jwt: pg_cron and unsubscribe links call it without a user token.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { bearer } from '../_shared/http.ts';
import { checkinFromRow, eventFromRow, fixedFromRow, habitFromRow, habitLogFromRow, taskFromRow } from '../_shared/rows.ts';
import { createSummaryHandler, type ProfileRow } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const PROFILE_COLUMNS = 'id, timezone, peak_start, peak_end, email_enabled, email_time, email_recipient, email_weekly';

const must = <T>({ data, error }: { data: T | null; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

Deno.serve(
  createSummaryHandler({
    now: () => Date.now(),
    cronSecret: Deno.env.get('CRON_SECRET') ?? '',
    unsubscribeSecret: Deno.env.get('UNSUBSCRIBE_SECRET') ?? '',
    appUrl: Deno.env.get('APP_URL') ?? 'http://localhost:5173',
    functionUrl: `${SUPABASE_URL}/functions/v1/daily-summary`,

    async authenticate(req) {
      const jwt = bearer(req);
      if (!jwt) return null;
      const { data } = await admin.auth.getUser(jwt);
      return data.user?.id ?? null;
    },

    async listEnabledProfiles() {
      return must(await admin.from('profiles').select(PROFILE_COLUMNS).eq('email_enabled', true)) as ProfileRow[];
    },

    async getProfile(userId) {
      return must(await admin.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()) as ProfileRow | null;
    },

    async loadUserData(userId, since) {
      const sinceIso = new Date(since).toISOString();
      const sinceDate = sinceIso.slice(0, 10);
      const [tasks, events, fixed, checkins, habits, logs] = await Promise.all([
        admin.from('tasks').select('*').eq('user_id', userId).is('deleted_at', null)
          .or(`status.in.(todo,scheduled,doing),updated_at.gte.${sinceIso}`),
        admin.from('task_events').select('*').eq('user_id', userId).gte('at', sinceIso),
        admin.from('fixed_events').select('*').eq('user_id', userId).is('deleted_at', null).gte('start_at', new Date(Date.now() - 86_400_000).toISOString()),
        admin.from('checkins').select('*').eq('user_id', userId).gte('date', sinceDate),
        admin.from('habits').select('*').eq('user_id', userId).is('deleted_at', null),
        admin.from('habit_logs').select('*').eq('user_id', userId).gte('date', sinceDate),
      ]);
      return {
        tasks: must(tasks).map(taskFromRow),
        events: must(events).map(eventFromRow),
        fixed: must(fixed).map(fixedFromRow),
        checkins: must(checkins).map(checkinFromRow),
        habits: must(habits).map(habitFromRow),
        habitLogs: must(logs).map(habitLogFromRow),
      };
    },

    async hasSent(userId, kind, date) {
      const rows = must(
        await admin.from('email_logs').select('id').eq('user_id', userId).eq('kind', kind).eq('for_date', date).eq('status', 'sent').limit(1),
      );
      return rows.length > 0;
    },

    async countTestsSince(userId, since) {
      const { count } = await admin
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('kind', 'test')
        .gte('created_at', new Date(since).toISOString());
      return count ?? 0;
    },

    async log(entry) {
      await admin.from('email_logs').insert({
        user_id: entry.userId,
        kind: entry.kind,
        for_date: entry.forDate,
        status: entry.status,
        provider_id: entry.providerId ?? null,
        error: entry.error ?? null,
      });
    },

    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: Deno.env.get('EMAIL_FROM') ?? 'Dayflow <onboarding@resend.dev>',
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? body.name ?? 'send failed'}`);
      return { id: body.id as string };
    },

    async disableEmails(userId) {
      must(await admin.from('profiles').update({ email_enabled: false, updated_at: new Date().toISOString() }).eq('id', userId));
    },
  }),
);
