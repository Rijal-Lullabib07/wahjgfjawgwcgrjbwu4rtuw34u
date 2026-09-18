/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { setCacheNameDetails } from 'workbox-core';
import { blobGet, queueGetAll, queueDelete, blobDelete, queueUpdate } from './lib/offline-sync/db';
import { submitLaporan } from './lib/supabase/api';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string }>;
};

setCacheNameDetails({ prefix: 'siplap', suffix: 'v1' });

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Supabase API & storage: NetworkFirst agar data segar, fallback cache saat offline
registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co'),
  new NetworkFirst({ cacheName: 'siplap-api', networkTimeoutSeconds: 8 }),
);

// ---------- Background Sync: kirim antrian laporan saat online lagi ----------

self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag: string };
  if (syncEvent.tag === 'siplap-sync') {
    syncEvent.waitUntil(syncFromSW());
  }
});

async function syncFromSW(): Promise<void> {
  const items = await queueGetAll();
  for (const item of items) {
    try {
      const blobs: Blob[] = [];
      for (const f of item.fotos) {
        const blob = await blobGet(f.blobKey);
        if (!blob) throw new Error('blob hilang');
        blobs.push(blob);
      }
      await submitLaporan(item, blobs);
      await queueDelete(item.localId);
      for (const f of item.fotos) await blobDelete(f.blobKey);
    } catch {
      // biarkan di antrian; dicoba lagi sync berikutnya
      await queueUpdate(item.localId, { status: 'pending' });
    }
  }
}

// ---------- Push notification ----------

self.addEventListener('push', (event) => {
  const pushEvent = event as ExtendableEvent & { data?: { json: () => unknown; text: () => string } | null };
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    const raw = pushEvent.data as { json?: () => unknown; text?: () => string } | null;
    data = raw && typeof raw.json === 'function' ? (raw.json() as typeof data) : {};
  } catch {
    data = {};
  }
  const opts: NotificationOptions & { vibrate?: number[] } = {
    body: data.body ?? 'Segera kirim laporan siklus Anda.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    // Tag sama dengan reminder lokal (localReminder.ts) → keduanya saling
    // MENGGANTIKAN, bukan menumpuk jadi dua notifikasi untuk hal yang sama.
    tag: data.tag ?? 'siplap-reminder',
    data: { url: data.url ?? '/' },
  };
  pushEvent.waitUntil(
    self.registration.showNotification(data.title ?? 'SIPLAP — Pengingat Laporan', opts),
  );
});

self.addEventListener('notificationclick', (event) => {
  const notifEvent = event as ExtendableEvent & {
    notification: Notification & { data?: { url?: string } };
  };
  notifEvent.notification.close();
  notifEvent.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(notifEvent.notification.data?.url ?? '/');
    }),
  );
});

// Pesan dari halaman: minta SW memicu sync segera (fallback iOS)
self.addEventListener('message', (event) => {
  const msgEvent = event as ExtendableEvent & { data?: unknown };
  if (msgEvent.data === 'TRIGGER_SYNC') {
    msgEvent.waitUntil?.(syncFromSW());
  }
});
