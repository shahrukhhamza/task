import { callFunction, cloudConfigured, getSupabase } from './client';

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** Push needs a service worker, the Push API, a VAPID key and a signed-in account. */
export const pushConfigured = (): boolean =>
  cloudConfigured && !!vapidKey && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

const keyBytes = (b64url: string): Uint8Array<ArrayBuffer> => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

/** Subscribes this device and registers it with the server. Safe to call repeatedly. */
export async function enablePush(): Promise<void> {
  if (!pushConfigured()) return;
  const supabase = await getSupabase();
  if (!supabase) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey as string) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.from('push_subscriptions').insert({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
  // 23505: this device is already registered
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function disablePush(): Promise<void> {
  if (!pushConfigured()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const supabase = await getSupabase();
  await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** True when this browser already holds a push subscription (it was registered with the server when it was made). */
export async function hasDeviceSubscription(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/** Asks the server to push a test notification to every device the user has registered. */
export async function sendTestPush(): Promise<{ devices: number; sent: number }> {
  return callFunction<{ devices: number; sent: number; failed: number }>('push-test', {});
}

/** iPhones only allow web notifications for apps added to the Home Screen. */
export function needsHomeScreenInstall(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !standalone;
}
