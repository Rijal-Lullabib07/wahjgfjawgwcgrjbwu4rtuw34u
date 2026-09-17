import { urlBase64ToUint8Array } from './vapid';
import { savePushSubscription } from '../supabase/api';

/**
 * Subscribe push notification untuk device ini dan simpan subscription
 * ke tabel push_subscriptions di Supabase (dipakai Edge Function reminder).
 */
export async function subscribePush(reguId: string | null): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Browser tidak mendukung push notification');
  }
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error('VITE_VAPID_PUBLIC_KEY belum diisi di .env');
  }

  // Minta izin notifikasi dulu
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Izin notifikasi ditolak. Aktifkan di pengaturan browser.');
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  await savePushSubscription(sub, reguId);
  return sub;
}

/** Kirim notifikasi tes lokal (tanpa server) untuk memastikan izin jalan. */
export async function testLocalNotification(): Promise<void> {
  if (Notification.permission !== 'granted') {
    throw new Error('Izin notifikasi belum diberikan');
  }
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('SIPLAP aktif ✅', {
    body: 'Notifikasi pengingat laporan siap diterima di device ini.',
    icon: '/icons/icon-192.png',
  });
}
