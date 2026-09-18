/**
 * Kunci publik VAPID untuk Web Push.
 *
 * Kunci ini AMAN ditaruh di frontend (memang harus publik). Pasangannya
 * (VAPID_PRIVATE_KEY) hanya ada di secret Edge Function `reminder-push`.
 *
 * Generate sekali:
 *   npx web-push generate-vapid-keys
 */

const raw = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();

/** Kunci publik VAPID dari .env (kosong bila belum diisi). */
export const vapidPublicKey = raw;

export function hasVapidKey(): boolean {
  return raw.length > 0;
}

/**
 * base64url → Uint8Array, sesuai format `PushSubscriptionOptions.applicationServerKey`.
 * (base64url pakai '-' & '_', bukan '+' & '/', dan tanpa padding.)
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
