/**
 * Web Push (VAPID) — pendaftaran perangkat regu ke server.
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

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker?.ready;
  if (!reg) {
    throw new Error(
      'Service worker belum aktif. Muat ulang halaman, lalu aktifkan notifikasi lagi.',
    );
  }
  return reg;
}

/** Baris tabel `push_subscriptions` dari objek PushSubscription browser. */
function toRow(sub: PushSubscription, reguId: string | undefined) {
  const json = sub.toJSON();
  return {
    regu_id: reguId ?? null,
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
  const row = toRow(sub, reguId);
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
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
}

/**
 * Minta izin + daftarkan perangkat. Wajib dipanggil dari event klik user.
 * Lempar Error dengan pesan siap-tampil bila gagal.
 */
export async function enablePush(reguId: string | undefined): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      'Browser ini tidak mendukung Web Push. Gunakan Chrome/Edge (Android/desktop), atau iOS 16.4+ dengan app sudah dipasang ke home screen.',
    );
  }
  if (!hasVapidKey()) {
    throw new Error(
      'VITE_VAPID_PUBLIC_KEY belum diisi di .env. Tambahkan kuncinya lalu muat ulang app.',
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      'Izin notifikasi ditolak. Aktifkan lewat pengaturan situs/browser, lalu coba lagi.',
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
  if (!pushSupported() || !hasVapidKey()) return false;
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
