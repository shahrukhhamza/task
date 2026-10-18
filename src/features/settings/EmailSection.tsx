import { Mail, Send } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button, Card, Chip, fieldClass } from '../../components/ui';
import { callFunction, getSupabase } from '../../lib/cloud/client';
import { syncNow } from '../../lib/cloud/session';
import { updateProfile } from '../../lib/db/actions';
import type { Profile } from '../../lib/types';
import { useCloud } from '../../store/cloud';
import { useUi } from '../../store/ui';

interface EmailLog {
  kind: string;
  for_date: string;
  status: string;
  error: string | null;
  created_at: string;
}

/** Nightly summary email: on/off, time, address, weekly edition, test send and history. */
export function EmailSection({ profile }: { profile: Profile }) {
  const id = useId();
  const user = useCloud((s) => s.user);
  const configured = useCloud((s) => s.configured);
  const toast = useUi((s) => s.toast);
  const [recipient, setRecipient] = useState(profile.emailRecipient);
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<EmailLog[]>([]);

  useEffect(() => setRecipient(profile.emailRecipient || user?.email || ''), [profile.emailRecipient, user?.email]);

  useEffect(() => {
    if (!user) return;
    void getSupabase()
      ?.then((s) => s.from('email_logs').select('kind, for_date, status, error, created_at').order('created_at', { ascending: false }).limit(5))
      .then(({ data }) => setLogs((data as EmailLog[]) ?? []));
  }, [user, sending]);

  if (!user) {
    return (
      <Card className="grid gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Mail size={18} /> Nightly summary email
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {configured
            ? 'Sign in to get a summary every night: your day score, what got done, where your time went, and tomorrow’s plan.'
            : 'A nightly summary of your day by email. Available once the cloud keys are set up (see the README).'}
        </p>
      </Card>
    );
  }

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);

  const sendTest = async (weekly: boolean) => {
    setSending(true);
    try {
      if (recipient !== profile.emailRecipient) await updateProfile({ emailRecipient: recipient });
      // the server reads the address from your synced profile, so sync first
      await syncNow();
      const result = await callFunction<{ to: string }>('daily-summary', { action: 'test', weekly });
      toast(`Test email sent to ${result.to}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t send the test email.', { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Mail size={18} /> Nightly summary email
        </h2>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            role="switch"
            className="h-4 w-4 accent-teal-700"
            checked={profile.emailEnabled}
            onChange={(e) => void updateProfile({ emailEnabled: e.target.checked, emailRecipient: recipient || profile.emailRecipient })}
          />
          {profile.emailEnabled ? 'On' : 'Off'}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-time`} className="mb-1 block text-sm font-medium">
            Send at
          </label>
          <input
            id={`${id}-time`}
            type="time"
            className={fieldClass}
            value={profile.emailTime}
            onChange={(e) => e.target.value && void updateProfile({ emailTime: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Your time ({profile.timezone}). Arrives within 15 minutes.</p>
        </div>
        <div>
          <label htmlFor={`${id}-to`} className="mb-1 block text-sm font-medium">
            Send to
          </label>
          <input
            id={`${id}-to`}
            type="email"
            className={fieldClass}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            onBlur={() => validEmail && recipient !== profile.emailRecipient && void updateProfile({ emailRecipient: recipient })}
            aria-invalid={!validEmail}
          />
          {!validEmail && <p className="mt-1 text-xs text-red-800 dark:text-red-300">Enter a valid email address.</p>}
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-teal-700" checked={profile.emailWeekly} onChange={(e) => void updateProfile({ emailWeekly: e.target.checked })} />
        Also send a weekly review on Sunday nights
      </label>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!validEmail || sending} onClick={() => void sendTest(false)}>
          <Send size={15} /> Send test email now
        </Button>
        <Button variant="ghost" disabled={!validEmail || sending} onClick={() => void sendTest(true)}>
          Preview the weekly email
        </Button>
        {profile.emailEnabled && (
          <Button variant="ghost" className="!text-red-700 dark:!text-red-300" onClick={() => void updateProfile({ emailEnabled: false })}>
            Unsubscribe from all emails
          </Button>
        )}
      </div>

      {logs.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Recent emails</p>
          <ul className="grid gap-1 text-sm">
            {logs.map((log) => (
              <li key={log.created_at} className="flex items-center justify-between gap-2">
                <span className="capitalize">
                  {log.kind} · {log.for_date}
                </span>
                {log.status === 'sent' ? <Chip tone="teal">Sent</Chip> : <Chip tone="red" title={log.error ?? undefined}>Failed</Chip>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
