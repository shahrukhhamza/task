import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, CloudOff, LogOut, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Chip } from '../../components/ui';
import { disconnectGoogle, importCalendarNow, signInWithGoogle, signOut, syncNow } from '../../lib/cloud/session';
import { db } from '../../lib/db/schema';
import { pendingCount } from '../../lib/sync/engine';
import { useCloud } from '../../store/cloud';
import { useUi } from '../../store/ui';

const ago = (ts?: number) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** Sign-in, sync status and Google Calendar connection. */
export function AccountSection() {
  const cloud = useCloud();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useLiveQuery(() => (cloud.user ? pendingCount(db) : Promise.resolve(0)), [cloud.user, cloud.lastSyncedAt]);

  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast(done);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (!cloud.configured) {
    return (
      <Card className="grid gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <CloudOff size={18} /> Account & sync
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Dayflow is running fully on this device. Sign-in, sync across devices, Google Calendar and email summaries switch on once the
          Supabase keys are added (see the README).
        </p>
      </Card>
    );
  }

  if (!cloud.ready) {
    return (
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-400">Checking your account…</p>
      </Card>
    );
  }

  if (!cloud.user) {
    return (
      <Card className="grid gap-3">
        <h2 className="font-semibold">Account & sync</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sign in to back up your plan, use it on all your devices, connect Google Calendar and get a nightly summary by email. Everything
          already on this device is uploaded when you sign in.
        </p>
        <Button variant="primary" disabled={busy === 'signin'} onClick={() => run('signin', signInWithGoogle)}>
          Sign in with Google
        </Button>
      </Card>
    );
  }

  const google = cloud.google;
  return (
    <Card className="grid gap-4">
      <div className="flex items-center gap-3">
        {cloud.user.avatarUrl ? (
          <img src={cloud.user.avatarUrl} alt="" className="h-10 w-10 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-700 font-semibold text-white">
            {(cloud.user.name ?? cloud.user.email).slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{cloud.user.name ?? cloud.user.email}</p>
          <p className="truncate text-sm text-slate-600 dark:text-slate-400">{cloud.user.email}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => run('signout', signOut, 'Signed out. Your data stays on this device.')}>
          <LogOut size={15} /> Sign out
        </Button>
      </div>

      <div className="grid gap-1.5 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">Sync</span>
          {cloud.syncStatus === 'error' ? (
            <Chip tone="red">Problem</Chip>
          ) : cloud.syncStatus === 'offline' ? (
            <Chip>Offline</Chip>
          ) : cloud.syncStatus === 'syncing' ? (
            <Chip tone="teal">Syncing…</Chip>
          ) : (
            <Chip tone="teal">Up to date</Chip>
          )}
        </div>
        <p className="text-slate-600 dark:text-slate-400">
          Last synced {ago(cloud.lastSyncedAt)}
          {pending ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting` : ''}
        </p>
        {cloud.syncError && <p className="text-red-800 dark:text-red-300">{cloud.syncError}</p>}
        <div>
          <Button size="sm" disabled={cloud.syncStatus === 'syncing'} onClick={() => run('sync', syncNow)}>
            <RefreshCw size={14} /> Sync now
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-medium">
            <CalendarCheck size={15} /> Google Calendar
          </span>
          {google === 'connected' ? (
            <Chip tone="teal">Connected</Chip>
          ) : google === 'reconnect' ? (
            <Chip tone="amber">Needs reconnect</Chip>
          ) : google === 'error' ? (
            <Chip tone="red">Problem</Chip>
          ) : google === 'unknown' ? (
            <Chip>Checking…</Chip>
          ) : (
            <Chip>Not connected</Chip>
          )}
        </div>
        {google === 'connected' && (
          <>
            <p className="text-slate-600 dark:text-slate-400">
              Your events block time in the plan, and tasks you add to the calendar stay in sync. Last import {ago(cloud.lastImportAt)}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy === 'import'} onClick={() => run('import', importCalendarNow, 'Calendar refreshed.')}>
                <RefreshCw size={14} /> Refresh events
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run('disconnect', disconnectGoogle, 'Google Calendar disconnected.')}>
                Disconnect
              </Button>
            </div>
          </>
        )}
        {(google === 'reconnect' || google === 'disconnected' || google === 'error') && (
          <>
            <p className="flex items-start gap-1.5 text-slate-700 dark:text-slate-300">
              {google !== 'disconnected' && <TriangleAlert size={15} className="mt-0.5 shrink-0" />}
              {google === 'reconnect'
                ? 'Google access has expired (this happens every 7 days while the Google app is in testing). Reconnect to keep syncing.'
                : google === 'error'
                  ? (cloud.googleError ?? 'Couldn’t reach Google Calendar.')
                  : 'Connect to avoid double-booking and to add tasks to your calendar.'}
            </p>
            <div>
              <Button size="sm" variant="primary" onClick={() => run('connect', signInWithGoogle)}>
                {google === 'disconnected' ? 'Connect Google Calendar' : 'Reconnect Google'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
