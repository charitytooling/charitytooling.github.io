/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

// Custom service worker. Phase 0 only precaches the app shell.
// Phase 7 adds `push`, `notificationclick`, and `pushsubscriptionchange` handlers.

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Placeholder push handler so the SW shape stays stable across phases.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json() as { title?: string; body?: string; url?: string };
    event.waitUntil(
      self.registration.showNotification(payload.title ?? 'CharityTooling', {
        body: payload.body ?? '',
        icon: '/icon.svg',
        badge: '/icon.svg',
        data: { url: payload.url ?? '/' },
      }),
    );
  } catch {
    // Ignore non-JSON payloads in Phase 0.
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string | undefined) ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          return client.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
