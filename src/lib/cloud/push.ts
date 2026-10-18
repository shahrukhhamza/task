import { cloudConfigured, getSupabase } from './client';

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
