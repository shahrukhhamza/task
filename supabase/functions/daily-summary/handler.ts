// Nightly (and Sunday weekly) summary emails.
//
//   POST + x-cron-secret         -> called by pg_cron every 15 minutes; sends to everyone
//                                   whose local send time has passed and who hasn't had
//                                   today's email yet
//   POST + user JWT {action:test} -> "Send test email now" from Settings
//   GET/POST ?action=unsubscribe  -> one-click unsubscribe from the email footer

import { dayReport, weekReport, type CheckinLike, type EventLike, type FixedLike, type HabitLike, type HabitLogLike, type TaskLike } from '../_shared/analytics.ts';
import { renderDailyEmail, renderWeeklyEmail, type EmailContext, type RenderedEmail } from '../_shared/email.ts';
import { corsHeaders, html, json, safeEqual } from '../_shared/http.ts';
import { sign, verify } from '../_shared/sign.ts';
import { dayKeyOf, localParts } from '../_shared/zone.ts';

export interface ProfileRow {
  id: string;
  timezone: string;
  peak_start: number;
  peak_end: number;
  email_enabled: boolean;
  email_time: string;
  email_recipient: string;
  email_weekly: boolean;
}

export interface UserData {
  tasks: TaskLike[];
  events: EventLike[];
  fixed: FixedLike[];
  checkins: CheckinLike[];
  habits: HabitLike[];
  habitLogs: HabitLogLike[];
}

export type EmailKind = 'daily' | 'weekly' | 'test';

export interface SummaryDeps {
  now(): number;
  cronSecret: string;
  unsubscribeSecret: string;
  /** Where the app is hosted, for links in the email. */
  appUrl: string;
  /** Public URL of this function, for the unsubscribe link. */
  functionUrl: string;
  authenticate(req: Request): Promise<string | null>;
  listEnabledProfiles(): Promise<ProfileRow[]>;
  getProfile(userId: string): Promise<ProfileRow | null>;
  /** Everything needed for the reports, from `since` onwards. */
  loadUserData(userId: string, since: number): Promise<UserData>;
  hasSent(userId: string, kind: EmailKind, date: string): Promise<boolean>;
  countTestsSince(userId: string, since: number): Promise<number>;
  log(entry: { userId: string; kind: EmailKind; forDate: string; status: 'sent' | 'failed'; providerId?: string; error?: string }): Promise<void>;
  send(message: { to: string; subject: string; html: string; text: string; headers: Record<string, string> }): Promise<{ id: string }>;
  disableEmails(userId: string): Promise<void>;
}

const HISTORY_DAYS = 35;
const TESTS_PER_HOUR = 5;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export async function unsubscribeUrl(deps: Pick<SummaryDeps, 'functionUrl' | 'unsubscribeSecret'>, userId: string): Promise<string> {
  const token = await sign(deps.unsubscribeSecret, `unsubscribe:${userId}`);
  return `${deps.functionUrl}?action=unsubscribe&u=${encodeURIComponent(userId)}&t=${token}`;
}

/** Is the nightly email due now for this profile? */
export function isDue(profile: Pick<ProfileRow, 'timezone' | 'email_time'>, now: number): boolean {
  const p = localParts(now, profile.timezone);
  return p.hour * 60 + p.minute >= toMinutes(profile.email_time);
}

export function createSummaryHandler(deps: SummaryDeps) {
  async function render(profile: ProfileRow, kind: 'daily' | 'weekly'): Promise<RenderedEmail> {
    const now = deps.now();
    const data = await deps.loadUserData(profile.id, now - HISTORY_DAYS * 86_400_000);
    const input = { ...data, timezone: profile.timezone, peakStart: profile.peak_start, peakEnd: profile.peak_end };
    const today = dayKeyOf(now, profile.timezone);
    const ctx: EmailContext = {
      timezone: profile.timezone,
      appUrl: deps.appUrl,
      settingsUrl: `${deps.appUrl.replace(/\/$/, '')}/settings`,
      unsubscribeUrl: await unsubscribeUrl(deps, profile.id),
    };
    return kind === 'weekly' ? renderWeeklyEmail(weekReport(input, today, now), ctx) : renderDailyEmail(dayReport(input, today, now), ctx);
  }

  async function deliver(profile: ProfileRow, kind: EmailKind, rendered: RenderedEmail, forDate: string): Promise<string> {
    const unsubscribe = await unsubscribeUrl(deps, profile.id);
    try {
      const { id } = await deps.send({
        to: profile.email_recipient,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          'List-Unsubscribe': `<${unsubscribe}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      await deps.log({ userId: profile.id, kind, forDate, status: 'sent', providerId: id });
      return id;
    } catch (err) {
      await deps.log({ userId: profile.id, kind, forDate, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async function runScheduled() {
    const now = deps.now();
    const result = { sent: 0, skipped: 0, failed: 0 };
    for (const profile of await deps.listEnabledProfiles()) {
      if (!profile.email_enabled || !profile.email_recipient || !isDue(profile, now)) {
        result.skipped++;
        continue;
      }
      const today = dayKeyOf(now, profile.timezone);
      const kinds: Array<'daily' | 'weekly'> = ['daily'];
      if (profile.email_weekly && localParts(now, profile.timezone).weekday === 0) kinds.push('weekly');

      for (const kind of kinds) {
        if (await deps.hasSent(profile.id, kind, today)) {
          result.skipped++;
          continue;
        }
        try {
          await deliver(profile, kind, await render(profile, kind), today);
          result.sent++;
        } catch {
          // logged in deliver(); one user's failure must not stop the others
          result.failed++;
        }
      }
    }
    return result;
  }

  async function handleUnsubscribe(url: URL): Promise<Response> {
    const userId = url.searchParams.get('u') ?? '';
    const token = url.searchParams.get('t') ?? '';
    if (!userId || !token || !(await verify(deps.unsubscribeSecret, `unsubscribe:${userId}`, token))) {
      return html(page('This link isn’t valid', 'Open Dayflow and turn emails off in Settings instead.'), 400);
    }
    await deps.disableEmails(userId);
    return html(page('You’re unsubscribed', 'You won’t get Dayflow summary emails any more. You can turn them back on in Settings at any time.'));
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    const url = new URL(req.url);

    try {
      if (url.searchParams.get('action') === 'unsubscribe') return await handleUnsubscribe(url);
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

      const cron = req.headers.get('x-cron-secret');
      if (cron !== null) {
        if (!deps.cronSecret || !safeEqual(cron, deps.cronSecret)) return json({ error: 'unauthorized' }, 401);
        return json(await runScheduled());
      }

      const userId = await deps.authenticate(req);
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => ({}))) as { action?: string; weekly?: boolean };
      if (body.action !== 'test') return json({ error: 'unknown_action' }, 400);

      const profile = await deps.getProfile(userId);
      if (!profile?.email_recipient) return json({ error: 'no_recipient', message: 'Add an email address first.' }, 400);
      if ((await deps.countTestsSince(userId, deps.now() - 3_600_000)) >= TESTS_PER_HOUR) {
        return json({ error: 'rate_limited', message: 'That’s enough test emails for now. Try again in an hour.' }, 429);
      }
      const today = dayKeyOf(deps.now(), profile.timezone);
      const id = await deliver(profile, 'test', await render(profile, body.weekly ? 'weekly' : 'daily'), today);
      return json({ ok: true, id, to: profile.email_recipient });
    } catch (err) {
      return json({ error: 'internal', message: err instanceof Error ? err.message : String(err) }, 500);
    }
  };
}

function page(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:16px;padding:32px;max-width:420px}h1{font-size:20px;margin:0 0 8px}p{color:#475569;line-height:1.5;margin:0}
@media (prefers-color-scheme:dark){body{background:#020617;color:#e2e8f0}main{background:#0f172a}p{color:#94a3b8}}</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

