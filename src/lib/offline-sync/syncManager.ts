import { submitLaporan } from '../supabase/api';
import {
  blobDelete,
  blobGet,
  queueDelete,
  queueGetAll,
  queueUpdate,
} from './db';

/**
 * Sync manager: mengirim antrian laporan ke Supabase saat koneksi tersedia.
 * - Berjalan di foreground (saat app dibuka / event online).
 * - Service Worker memicu sync ulang via Background Sync (Android/Chromium).
 */

let syncing = false;

export async function syncPendingLaporan(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = await queueGetAll();
    for (const item of items) {
      if (item.status === 'syncing') continue;
      try {
        await queueUpdate(item.localId, { status: 'syncing' });
        const blobs: Blob[] = [];
        for (const f of item.fotos) {
          const blob = await blobGet(f.blobKey);
          if (!blob) throw new Error('Blob foto hilang dari IndexedDB');
          blobs.push(blob);
        }
        await submitLaporan(item, blobs);
        await queueDelete(item.localId);
        for (const f of item.fotos) await blobDelete(f.blobKey);
        synced++;
      } catch (err) {
        failed++;
        const attempts = item.attempts + 1;
        await queueUpdate(item.localId, {
          status: attempts >= 5 ? 'failed' : 'pending',
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}

/** Minta SW melakukan background sync (Android/Chromium). */
export async function requestBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sync = (
      reg as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;
    await sync?.register('siplap-sync');
  } catch {
    // Browser tidak mendukung Background Sync — fallback: retry on foreground.
  }
}

/** Pasang listener agar sync otomatis jalan saat kembali online. */
export function installOnlineListener(): () => void {
  const onOnline = () => {
    void syncPendingLaporan();
  };
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}
