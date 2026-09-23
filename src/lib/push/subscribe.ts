/**
 * Web Push (VAPID) — pendaftaran perangkat regu di Android & iOS.
 *
 * ALUR:
 *   1. Minta izin notifikasi (harus dipicu klik user).
 *   2. Ambil Service Worker yang sudah terdaftar (vite-plugin-pwa).
 *   3. pushManager.subscribe() → dapat endpoint + kunci p256dh/auth.
 *   4. Simpan ke tabel `push_subscriptions` (terikat ke regu yang login).
 *   5. Edge Function `reminder-push` (dipicu pg_cron) mengirim push ke endpoint
 *      itu walau app sedang tertutup / HP di kantong.
 *
 * Ini jalur UTAMA. `localReminder.ts` adalah lapis cadangan saat push tidak bisa
 * dipakai (izin ditolak, iOS < 16.4, atau .env belum diisi).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';
import { hasVapidKey, urlBase64ToUint8Array, vapidPublicKey } from './vapid';
import { getPlatform, loadSession } from '../session';

function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di .env.',
    );
  }
  return supabase;
}

/** Fitur yang dibutuhkan: service worker + Push API + Notification. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Kode penyebab push tidak tersedia — dipakai modal setup untuk menampilkan
 * panduan yang TEPAT sesuai platform (Android ≠ iOS).
 */
export type PushBlocker =
  | 'insecure-context'   // bukan HTTPS / bukan localhost
  | 'no-service-worker'  // browser tidak mendukung SW sama sekali
  | 'no-push'            // ada SW tapi PushManager tidak ada (mis. WebView/EFW)
  | 'no-notification'    // Notification API tidak ada (mis. Firefox Android lama)
  | null;                // null = didukung

/** Deteksi penyebab push tidak jalan di browser ini. */
export function getPushBlocker(): PushBlocker {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'no-service-worker';
  }
  if (window.isSecureContext !== true) return 'insecure-context';
  if (!('serviceWorker' in navigator)) return 'no-service-worker';
  if (!('Notification' in window)) return 'no-notification';
  if (!('PushManager' in window)) return 'no-push';
  return null;
}

/** Pesan ramah-user untuk tiap penyebab, disesuaikan platform. */
export function describePushBlocker(blocker: Exclude<PushBlocker, null>): string {
  const p = getPlatform();
  switch (blocker) {
    case 'insecure-context':
      return 'Notifikasi butuh koneksi HTTPS. Buka app lewat alamat https:// (atau localhost untuk uji coba).';
    case 'no-service-worker':
      return p === 'android'
        ? 'Browser ini tidak mendukung service worker. Gunakan Chrome atau Samsung Internet terbaru.'
        : 'Browser ini tidak mendukung service worker.';
    case 'no-notification':
    case 'no-push':
      // Android WebView (browser dalam-app Facebook/WhatsApp/dll) tidak punya
      // PushManager → ini penyebab paling umum "tombol notifikasi tidak jalan".
      return p === 'android'
        ? 'Browser/WebView ini tidak mendukung Web Push. Jangan buka SALAM PRESISI dari link WhatsApp/Facebook — buka Chrome langsung, atau lebih baik pasang SALAM PRESISI ke Home Screen (lihat tombol Pasang App).'
        : 'Browser ini tidak mendukung Web Push. Gunakan Safari iOS 16.4+ dengan app terpasang ke Home Screen.';
  }
}

/**
 * Ambil SW registration, dengan retry singkat.
 * `navigator.serviceWorker.ready` saja bisa menggantung selamanya bila SW
 * gagal terpasang (mis. update error) — user hanya melihat tombol " diam".
 */
async function getRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error(describePushBlocker('no-service-worker'));
  }
  const ready: Promise<ServiceWorkerRegistration | undefined> =
    navigator.serviceWorker.ready.catch(() => undefined);
  const reg = await Promise.race([
    ready,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
  if (!reg) {
    throw new Error(
      'Service worker belum aktif. Tutup semua tab SALAM PRESISI, buka lagi, tunggu beberapa detik, lalu coba sekali lagi.',
    );
  }
  return reg;
}

/** Baris tabel `push_subscriptions` dari objek PushSubscription browser. */
function toRow(
  sub: PushSubscription,
  reguId: string | undefined,
  monitorId: string | undefined,
) {
  const json = sub.toJSON();
  return {
    regu_id: reguId ?? null,
    monitor_id: monitorId ?? null,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    user_agent: navigator.userAgent.slice(0, 300),
  };
}

/**
 * Simpan/perbarui subscription.
 * Lewat RPC `claim_push_subscription` (migration 0004) supaya baris milik
 * endpoint yang sama bisa dipindah ke regu yang sedang login — mis. satu HP
 * dipakai bergantian oleh dua regu.
 */
async function saveSubscription(
  sub: PushSubscription,
  reguId: string | undefined,
): Promise<void> {
  const client = requireClient();
  // Pemantau (admin/pimpinan) tidak punya regu — subscription terikat ke
  // monitor_id (admin_users.id) yang disimpan saat login. Migration 0024
  // menambah kolom monitor_id + RLS-nya; tanpa itu upsert pemantau ditolak.
  const session = loadSession();
  const isMonitor =
    !reguId && (session?.role === 'admin' || session?.role === 'pimpinan');
  const monitorId = isMonitor ? session?.monitorId : undefined;
  const row = toRow(sub, reguId, monitorId);
  if (!row.p256dh || !row.auth) {
    throw new Error('Subscription dari browser tidak berisi kunci p256dh/auth.');
  }

  const { error: rpcErr } = await client.rpc('claim_push_subscription', {
    p_endpoint: row.endpoint,
    p_p256dh: row.p256dh,
    p_auth: row.auth,
    p_user_agent: row.user_agent,
  });
  if (!rpcErr) return;

  // Fallback bila migration 0004 belum dijalankan: upsert biasa (cukup untuk
  // device yang belum pernah dipakai regu lain).
  const { error } = await client
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
}

/** Bandingkan kunci VAPID yang dipegang browser dengan yang ada di .env. */
function toBytes(src: BufferSource | null | undefined): Uint8Array | null {
  if (!src) return null;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
}

function sameKey(src: BufferSource | null | undefined, expected: Uint8Array): boolean {
  const got = toBytes(src);
  if (!got || got.length !== expected.length) return false;
  return got.every((b, i) => b === expected[i]);
}

/**
 * Ambil subscription yang KUNCI-nya cocok. Bila kunci .env pernah diganti
 * setelah perangkat mendaftar, subscription lama masih terikat kunci lama dan
 * push service akan menolak kiriman (403 UnauthorizedRegistration). Dalam kasus
 * itu subscription lama dibatalkan lalu dibuat ulang.
 */
async function getOrCreateSubscription(
  reg: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const key = urlBase64ToUint8Array(vapidPublicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameKey(existing.options?.applicationServerKey, key)) {
    return existing;
  }
  if (existing) await existing.unsubscribe().catch(() => undefined);
  try {
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  } catch (err) {
    // Chrome Android menolak subscribe meski izin "granted" bila notifikasi
    // app dimatikan di level OS, atau di WebView tanpa dukungan FCM.
    const p = getPlatform();
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      p === 'android'
        ? `Browser menolak registrasi push (${detail}). Cek Pengaturan Android → Aplikasi → Chrome/SALAM PRESISI → Notifikasi dalam keadaan aktif, lalu coba lagi.`
        : `Browser menolak registrasi push (${detail}). Pastikan izin notifikasi diaktifkan lalu coba lagi.`,
    );
  }
}

/**
 * Minta izin + daftarkan perangkat. Wajib dipanggil dari event klik user.
 * Lempar Error dengan pesan siap-tampil bila gagal.
 */
export async function enablePush(reguId: string | undefined): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    throw new Error(describePushBlocker('no-notification'));
  }
  const blocker = getPushBlocker();
  if (blocker) throw new Error(describePushBlocker(blocker));
  if (!hasVapidKey()) {
    throw new Error(
      'VITE_VAPID_PUBLIC_KEY belum diisi di .env. Tambahkan kuncinya lalu muat ulang app.',
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const p = getPlatform();
    throw new Error(
      p === 'android'
        ? 'Izin notifikasi ditolak. Sentuh ikon 🔒 di address bar Chrome → Izin → Notifikasi → Izinkan, lalu coba lagi.'
        : 'Izin notifikasi ditolak. Buka Pengaturan Safari/SALAM PRESISI → Notifikasi → Izinkan, lalu coba lagi.',
    );
  }

  const reg = await getRegistration();
  const sub = await getOrCreateSubscription(reg);
  await saveSubscription(sub, reguId);
}

/**
 * Segarkan data subscription yang sudah ada (tanpa meminta izin).
 * Dipanggil saat app dibuka: memastikan baris di `push_subscriptions` menunjuk
 * ke regu yang sedang login + kunci masih terbaru (browser bisa merotasi).
 * Return true bila server push siap dipakai.
 */
export async function syncPushSubscription(
  reguId: string | undefined,
): Promise<boolean> {
  if (getPushBlocker() || !hasVapidKey()) return false;
  if (notificationPermission() !== 'granted') return false;
  try {
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    // Belum pernah mendaftar, atau kunci .env sudah diganti → biarkan user
    // menekan "Aktifkan" (butuh klik) agar subscription dibuat ulang dengan kunci baru.
    if (!sub) return false;
    if (!sameKey(sub.options?.applicationServerKey, urlBase64ToUint8Array(vapidPublicKey))) {
      return false;
    }
    await saveSubscription(sub, reguId);
    return true;
  } catch {
    return false;
  }
}

/** Batalkan subscription di browser + hapus barisnya di DB. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  if (supabase) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  }
  await sub.unsubscribe();
}
