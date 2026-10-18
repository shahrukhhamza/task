import { useEffect } from 'react';
import { dueReminders, reminderPayload } from '../../supabase/functions/_shared/reminders.ts';
import type { Profile, Task } from './types';

const SEEN_KEY = 'dayflow-reminded';
const CHECK_EVERY_MS = 30_000;

export const notificationsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

/** Shows a notification through the service worker when possible (needed on Android and for installed apps). */
export async function showNotification(title: string, options: NotificationOptions & { data?: { url: string } }): Promise<void> {
  const opts = { icon: '/icon-192.png', badge: '/icon-192.png', ...options };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    /* fall back to a page notification */
  }
  new Notification(title, opts);
}

function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<string, number>) {
  const cutoff = Date.now() - 2 * 86_400_000;
  const kept = Object.fromEntries(Object.entries(seen).filter(([, at]) => at > cutoff));
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch {
    /* storage full or blocked; worst case a reminder repeats */
  }
}

/**
 * While Dayflow is open (including in a background tab), notifies shortly before each
 * block. Push from the server covers the closed-app case; both use the same tag, so
 * the browser shows a reminder once.
 */
export function useReminders(tasks: Task[], profile: Profile): void {
  useEffect(() => {
    if (!profile.remindersEnabled || !notificationsSupported()) return;

    const check = () => {
      if (Notification.permission !== 'granted') return;
      const now = Date.now();
      const seen = loadSeen();
      const due = dueReminders({ leadMin: profile.reminderLeadMin, tasks }, now).filter((r) => !seen[r.key]);
      for (const reminder of due) {
        const payload = reminderPayload(reminder, profile.timezone, now);
        void showNotification(payload.title, { body: payload.body, tag: payload.tag, data: { url: payload.url } });
        seen[reminder.key] = now;
      }
      if (due.length) saveSeen(seen);
    };

    check();
    const id = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, [tasks, profile.remindersEnabled, profile.reminderLeadMin, profile.timezone]);
}
