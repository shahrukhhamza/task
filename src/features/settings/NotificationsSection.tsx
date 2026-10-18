import { Bell, BellOff } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, fieldClass } from '../../components/ui';
import { disablePush, enablePush, pushConfigured } from '../../lib/cloud/push';
import { updateProfile } from '../../lib/db/actions';
import { notificationsSupported, requestNotificationPermission, showNotification } from '../../lib/notify';
import type { Profile } from '../../lib/types';
import { useCloud } from '../../store/cloud';
import { useUi } from '../../store/ui';

const LEADS = [0, 2, 5, 10, 15, 30];

export function NotificationsSection({ profile }: { profile: Profile }) {
  const toast = useUi((s) => s.toast);
  const signedIn = useCloud((s) => !!s.user);
  const configured = useCloud((s) => s.configured);
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : 'unsupported'));

  if (!notificationsSupported()) {
    return (
      <Card className="grid gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <BellOff size={18} /> Reminders
        </h2>
        <p className="text-sm text-muted">This browser can’t show notifications. On iPhone, add Dayflow to your Home Screen first.</p>
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
    toast('Reminders off.');
  };

  const background = signedIn && pushConfigured();

  return (
    <Card className="grid gap-3">
      <h2 className="flex items-center gap-2 font-semibold">
        <Bell size={18} /> Reminders
      </h2>
      <p className="text-sm text-muted">
        A notification shortly before each planned block.{' '}
        {background
          ? 'They arrive even when Dayflow is closed.'
          : configured
            ? 'They arrive while Dayflow is open or running in a tab. Sign in to get them when it’s closed, too.'
            : 'They arrive while Dayflow is open or running in a tab.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {profile.remindersEnabled && permission === 'granted' ? (
          <Button onClick={turnOff}>Turn reminders off</Button>
        ) : (
          <Button variant="primary" onClick={turnOn}>
            Turn reminders on
          </Button>
        )}
        <label className="inline-flex items-center gap-2 text-sm">
          Notify me
          <select
            className={`${fieldClass} !w-auto`}
            value={profile.reminderLeadMin}
            onChange={(e) => void updateProfile({ reminderLeadMin: +e.target.value })}
          >
            {LEADS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'when it starts' : `${m} min before`}
              </option>
            ))}
          </select>
        </label>
        {permission === 'granted' && (
          <Button size="sm" variant="ghost" onClick={() => void showNotification('Up next: Test reminder', { body: 'This is what reminders look like.', tag: 'dayflow-test' })}>
            Send a test
          </Button>
        )}
      </div>
      {permission === 'denied' && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.
        </p>
      )}
    </Card>
  );
}
