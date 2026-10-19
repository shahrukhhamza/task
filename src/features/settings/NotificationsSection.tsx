import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button, Card, fieldClass } from '../../components/ui';
import { FunctionError } from '../../lib/cloud/client';
import { disablePush, enablePush, hasDeviceSubscription, needsHomeScreenInstall, pushConfigured, sendTestPush } from '../../lib/cloud/push';
import { updateProfile } from '../../lib/db/actions';
import { notificationsSupported, requestNotificationPermission, showNotification } from '../../lib/notify';
import type { Profile } from '../../lib/types';
import { useCloud } from '../../store/cloud';
import { useUi } from '../../store/ui';

const LEADS = [0, 2, 5, 10, 15, 30];

type Flag = 'pushMorning' | 'pushDeadlines' | 'pushEvening';

// text on its own line on phones, text and controls side by side from `sm` up
const ROW = 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border border-line p-3.5';
const TEXT = 'min-w-0 basis-full sm:flex-1 sm:basis-0';

/** One kind of push: a switch with a short description and, optionally, the time it arrives. */
function Choice({
  title,
  hint,
  flag,
  timeKey,
  profile,
  disabled,
}: {
  title: string;
  hint: string;
  flag: Flag;
  timeKey?: 'pushMorningTime' | 'pushEveningTime';
  profile: Profile;
  disabled: boolean;
}) {
  const id = useId();
  const on = profile[flag];
  return (
    <li className={ROW}>
      <div className={TEXT}>
        <label htmlFor={id} className="block cursor-pointer text-[15px] font-medium">
          {title}
        </label>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {timeKey && on && (
          <input
            type="time"
            aria-label={`${title} time`}
            className={`${fieldClass} !w-auto`}
            value={profile[timeKey]}
            disabled={disabled}
            onChange={(e) => e.target.value && void updateProfile({ [timeKey]: e.target.value })}
          />
        )}
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="h-5 w-5 shrink-0 accent-[var(--app-fg)]"
          checked={on}
          disabled={disabled}
          onChange={(e) => void updateProfile({ [flag]: e.target.checked })}
        />
      </div>
    </li>
  );
}

export function NotificationsSection({ profile }: { profile: Profile }) {
  const toast = useUi((s) => s.toast);
  const signedIn = useCloud((s) => !!s.user);
  const configured = useCloud((s) => s.configured);
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : 'unsupported'));
  const [registered, setRegistered] = useState(false);
  const [testing, setTesting] = useState(false);

  const background = signedIn && pushConfigured();
  useEffect(() => {
    let cancelled = false;
    void hasDeviceSubscription().then((has) => !cancelled && setRegistered(has));
    return () => {
      cancelled = true;
    };
  }, [profile.remindersEnabled, permission, signedIn]);

  if (!notificationsSupported()) {
    return (
      <Card className="grid gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <BellOff size={18} /> Reminders
        </h2>
        <p className="text-sm text-muted">
          {needsHomeScreenInstall()
            ? 'On iPhone, notifications work once Dayflow is on your Home Screen: tap Share, then “Add to Home Screen”, and open it from there.'
            : 'This browser can’t show notifications. Try Chrome, Edge or Safari, or install Dayflow from your browser’s menu.'}
        </p>
      </Card>
    );
  }

  const turnOn = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result !== 'granted') {
      toast('Notifications are blocked. Allow them for this site in your browser settings.', { tone: 'error' });
      return;
    }
    await updateProfile({ remindersEnabled: true });
    if (signedIn) {
      try {
        await enablePush();
        setRegistered(await hasDeviceSubscription());
      } catch (err) {
        toast(`Reminders work while Dayflow is open, but background push failed: ${err instanceof Error ? err.message : err}`, { tone: 'error' });
        return;
      }
    }
    toast('Reminders on.');
  };

  const turnOff = async () => {
    await updateProfile({ remindersEnabled: false });
    await disablePush().catch(() => undefined);
    setRegistered(false);
    toast('Reminders off.');
  };

  const test = async () => {
    // a real push through the server proves the whole chain; without one, show it locally
    if (background && registered) {
      setTesting(true);
      try {
        const { devices } = await sendTestPush();
        toast(`Sent to ${devices === 1 ? 'this device' : `${devices} devices`}. It should arrive in a few seconds.`);
      } catch (err) {
        toast(err instanceof FunctionError || err instanceof Error ? err.message : 'The test failed.', { tone: 'error' });
      } finally {
        setTesting(false);
      }
      return;
    }
    void showNotification('Up next: Test reminder', { body: 'This is what reminders look like.', tag: 'dayflow-test' });
  };

  const enabled = profile.remindersEnabled && permission === 'granted';

  return (
    <Card className="grid gap-4">
      <h2 className="flex items-center gap-2 font-medium">
        <Bell size={18} /> Notifications
      </h2>

      <p className="text-sm text-muted">
        {background
          ? 'Dayflow can notify you on this phone even when the app is closed, as long as it has internet.'
          : configured
            ? 'Notifications arrive while Dayflow is open. Sign in to get them when it’s closed, too.'
            : 'Notifications arrive while Dayflow is open or running in a tab.'}
      </p>

      {enabled && background && (
        <p className={`flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-medium ${registered ? 'bg-card-lime text-ink dark:bg-surface-2 dark:text-fg' : 'bg-surface-2'}`}>
          <Smartphone size={16} aria-hidden />
          {registered ? 'This device is registered for background notifications.' : 'This device isn’t registered yet. Turn notifications off and on again.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {enabled ? (
          <Button onClick={turnOff}>Turn notifications off</Button>
        ) : (
          <Button variant="primary" onClick={turnOn}>
            Turn notifications on
          </Button>
        )}
        {permission === 'granted' && (
          <Button size="sm" variant="ghost" disabled={testing} onClick={() => void test()}>
            <BellRing size={15} /> {testing ? 'Sending…' : background && registered ? 'Send a test to this phone' : 'Send a test'}
          </Button>
        )}
      </div>

      {permission === 'denied' && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.
        </p>
      )}

      {enabled && (
        <>
          <div>
            <p className="mb-2 text-sm font-medium">What to send</p>
            <ul className="grid gap-2">
              <li className={ROW}>
                <div className={TEXT}>
                  <p className="text-[15px] font-medium">Before each task</p>
                  <p className="text-sm text-muted">A reminder shortly before a planned block or appointment starts.</p>
                </div>
                <select
                  aria-label="How early to remind you"
                  className={`${fieldClass} !w-auto sm:ml-auto`}
                  value={profile.reminderLeadMin}
                  onChange={(e) => void updateProfile({ reminderLeadMin: +e.target.value })}
                >
                  {LEADS.map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'When it starts' : `${m} min before`}
                    </option>
                  ))}
                </select>
              </li>
              <Choice title="Morning plan" hint="How many things are planned today and what comes first." flag="pushMorning" timeKey="pushMorningTime" profile={profile} disabled={!background} />
              <Choice title="Deadline alerts" hint="An hour before a deadline that has a set time." flag="pushDeadlines" profile={profile} disabled={!background} />
              <Choice title="Evening wrap-up" hint="What you finished, what’s left, and how tomorrow starts." flag="pushEvening" timeKey="pushEveningTime" profile={profile} disabled={!background} />
            </ul>
            {!background && <p className="mt-2 text-xs text-muted">The morning, deadline and evening notifications come from the server, so they need you signed in.</p>}
            <p className="mt-2 text-xs text-muted">Times follow your timezone ({profile.timezone}).</p>
          </div>
        </>
      )}
    </Card>
  );
}
