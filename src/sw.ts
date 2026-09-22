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

// ---------- Update PWA: aktivasi SW baru dikendalikan tombol "Perbarui" ----------
//
// SW baru TIDAK otomatis aktif setelah install (registerType "prompt"): ia
// menunggu di state `waiting` sementara toast "Versi baru tersedia" tampil di
// halaman. Ketika user menekan tombol Perbarui, appUpdate.ts mengirim pesan
// SKIP_WAITING ke SW yang menunggu — BARU di sini skipWaiting() dipanggil.
// clients.claim() pada event activate membuat SW baru mengambil kendali
// halaman yang sudah terbuka → controllerchange terpicu → halaman reload dan
// memuat versi terbaru. Alur ini bekerja di Android maupun iOS home-screen
// PWA tanpa install ulang / add-to-home-screen ulang.
self.addEventListener('message', (event) => {
  const msgEvent = event as ExtendableEvent & { data?: unknown };
  if (msgEvent.data === 'TRIGGER_SYNC') {
    msgEvent.waitUntil?.(syncFromSW());
    return;
  }
  const pesan = msgEvent.data as { type?: string } | null | undefined;
  if (pesan && typeof pesan === 'object' && pesan.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Setelah aktif, ambil kendali semua client yang sudah terbuka agar halaman
// tahu versi baru sudah berjalan (memunculkan controllerchange di halaman).
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

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

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  laporanId?: string;
  folderKey?: string;
}

self.addEventListener('push', (event) => {
  const pushEvent = event as ExtendableEvent & { data?: { json: () => unknown; text: () => string } | null };
  let data: PushData = {};
  try {
    const raw = pushEvent.data as { json?: () => unknown; text?: () => string } | null;
    data = raw && typeof raw.json === 'function' ? (raw.json() as PushData) : {};
  } catch {
    data = {};
  }
  pushEvent.waitUntil(handlePush(data));
});

async function handlePush(data: PushData): Promise<void> {
  const isLaporan = data.tag === 'siplap-laporan';

  if (isLaporan) {
    // Kalau app sedang TERBUKA (ada window visible), TAHAN notifikasi sistem
    // supaya tidak dobel dengan popup in-app — teruskan isi push ke halaman.
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const visibleClient = clientList.find(
      (client) => (client as WindowClient).visibilityState === 'visible',
    );
    if (visibleClient) {
      visibleClient.postMessage({ type: 'SIPLAP_LAPORAN_PUSH', data });
      return;
    }
  }

  const opts: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: isLaporan
      ? (data.body ?? 'Laporan baru masuk.')
      : (data.body ?? 'Ada pemberitahuan baru dari SALAM PRESISI.'),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    // Tag sama dengan reminder lokal (localReminder.ts) → keduanya saling
    // MENGGANTIKAN, bukan menumpuk jadi dua notifikasi untuk hal yang sama.
    tag: data.tag ?? 'siplap-reminder',
    // Android mengganti notifikasi bertag sama secara DIAM; renotify membuat
    // pengingat berulang tetap berbunyi & bergetar.
    renotify: true,
    // Untuk laporan: url membawa folder tujuan (/?folder=<key>) → klik
    // notifikasi langsung membuka folder yang benar.
    data: { url: data.url ?? '/' },
  };
  await self.registration.showNotification(
    isLaporan
      ? (data.title ?? 'SALAM PRESISI — Laporan Baru')
      : (data.title ?? 'SALAM PRESISI — Pengingat Laporan'),
    opts,
  );
}

self.addEventListener('notificationclick', (event) => {
  const notifEvent = event as ExtendableEvent & {
    notification: Notification & { data?: { url?: string } };
  };
  notifEvent.notification.close();
  const rawUrl = notifEvent.notification.data?.url ?? '/';
  let targetUrl = self.location.origin + '/';
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    // Notifications must stay inside this PWA's origin and scope.
    targetUrl = parsed.origin === self.location.origin ? parsed.href : targetUrl;
  } catch {
    // Keep the app root as a safe fallback for malformed notification data.
  }

  notifEvent.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const client = list.find((item) => 'focus' in item);
      if (client) {
        // Android often keeps the PWA window alive in the background. Focusing
        // without navigating leaves the user on a stale screen.
        if ('navigate' in client) {
          await client.navigate(targetUrl).catch(() => undefined);
        }
        await client.focus();
        return;
      }
      await self.clients.openWindow(targetUrl);
    }),
  );
});


