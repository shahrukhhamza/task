/// <reference lib="webworker" />
// Service worker: offline app shell plus reminder notifications.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// every in-app URL is served by the cached index.html, so the app opens offline
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

interface ReminderPayload {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
}

/** Web Push from the send-reminders Edge Function (works while the app is closed). */
self.addEventListener('push', (event) => {
  let data: ReminderPayload = { title: 'Dayflow' };
  try {
    data = event.data?.json() ?? data;
  } catch {
    data = { title: 'Dayflow', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // the same tag as the in-app reminder, so one block never shows two notifications
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
