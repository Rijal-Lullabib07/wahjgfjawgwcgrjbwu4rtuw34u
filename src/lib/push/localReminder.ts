/**
 * Reminder notifikasi LOKAL (murni client-side, tanpa server).
 *
 * Konsep: aplikasi sendiri yang memantau waktu siklus. Saat memasuki
 * 15 menit terakhir siklus berjalan dan regu belum melengkapi 2 foto,
 * munculkan notifikasi lokal (via service worker agar tampil walau app
 * di background/minimize).
 *
 * Tidak butuh VAPID, Edge Function, pg_cron, maupun tabel push_subscriptions.
 * Catatan jujur: notifikasi hanya muncul saat app masih "hidup" (tab terbuka,
 * PWA terpasang di Android, atau PWA terpasang di iOS yang masih menyimpan
 * state). Server push tetap lebih andal untuk app yang ditutup total.
 */

import { getCurrentCycle, FOTOS_PER_SIKLUS } from '../cycle';
import { fetchLaporan } from '../supabase/api';
import { queueGetAll } from '../offline-sync/db';
import type { QueuedLaporan } from '../../types';

const CHECK_INTERVAL_MS = 30_000; // cek tiap 30 detik

interface LocalReminderHandle {
  stop: () => void;
}

/** Kirim notifikasi lewat service worker (fallback ke Notification biasa). */
async function showLocalNotification(title: string, body: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'siplap-reminder', // dedupe: 1 notifikasi per waktu
        // Android mengganti notifikasi bertag sama secara diam — renotify
        // membuat pengingat berulang tetap berbunyi & bergetar.
        renotify: true,
        data: { url: '/' },
      } as NotificationOptions & { vibrate?: number[]; renotify?: boolean });
      return;
    }
  } catch {
    /* SW belum siap → fallback di bawah */
  }
  new Notification(title, { body, icon: '/icons/icon-192.png' });
}

/**
 * Hitung "foto terkirim" siklus berjalan:
 * - laporan tersimpan di Supabase (hasil sync sukses), ditambah
 * - foto masih di antrian offline (IndexedDB) karena belum sempat sync.
 */
async function countCurrentCycleFotos(
  reguId: string | undefined,
  cycleStart: Date,
  cycleEnd: Date,
  siklusKe: number,
): Promise<number> {
  let total = 0;
  try {
    const rows = await fetchLaporan({
      reguId,
      from: cycleStart,
      to: cycleEnd,
      limit: 50,
    });
    total += rows.reduce((acc, r) => acc + (r.fotos?.length ?? 0), 0);
  } catch {
    /* offline: abaikan server, antrian lokal tetap dihitung */
  }
  try {
    const q = (await queueGetAll()) as QueuedLaporan[];
    total += q
      .filter((i) => i.reguId === reguId && i.siklusKe === siklusKe)
      .reduce((acc, i) => acc + i.fotos.length, 0);
  } catch {
    /* IndexedDB gagal → anggap 0 */
  }
  return total;
}

/** Satu iterasi pengecekan reminder. */
async function checkAndNotify(reguId: string | undefined): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const cycle = getCurrentCycle();
  // Hanya ingatkan di 15 menit terakhir siklus (sama seperti perilaku lama)
  if (cycle.minutesLeft > 15 || cycle.minutesLeft <= 0) return;

  const fotoTerkirim = await countCurrentCycleFotos(
    reguId,
    cycle.start,
    cycle.end,
    cycle.siklusKe,
  );
  if (fotoTerkirim >= FOTOS_PER_SIKLUS) return; // sudah lengkap → tidak perlu reminder

  await showLocalNotification(
    '⏰ Pengingat SIPLAP',
    `Regu Anda: ${cycle.minutesLeft} menit lagi batas siklus ${cycle.siklusKe} berakhir. Segera kirim laporan!`,
  );
}

/**
 * Mulai loop reminder lokal untuk regu tertentu.
 * Cek tiap 30 detik; notifikasi diulang tiap 5 menit selama quota belum terpenuhi
 * (tag sama → Android/iOS otomatis mengganti, tidak menumpuk).
 * Return fungsi stop() untuk membersihkan saat logout/unmount.
 */
export function startLocalReminder(reguId: string | undefined): LocalReminderHandle {
  let stopped = false;
  let timer: number | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await checkAndNotify(reguId);
    } catch {
      /* jangan biarkan loop mati karena error sekali */
    }
    if (!stopped) timer = window.setTimeout(tick, CHECK_INTERVAL_MS);
  };

  // Jangan langsung notif saat buka app; mulai cek setelah 30 detik
  timer = window.setTimeout(tick, CHECK_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    },
  };
}
