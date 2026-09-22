/**
 * Manajemen update PWA — mengatasi keluhan "app di HP tidak pernah update".
 *
 * Masalah: app PWA yang dibuka dari home screen disajikan dari cache service
 * worker, dan browser (apalagi iOS) jarang mengecek versi baru secara
 * proaktif — apalagi kalau app hanya standby, bukan dimuat ulang dari nol.
 *
 * Solusi di modul ini:
 * 1. `initAppUpdate()` — dipasang sekali di App: paksa `registration.update()`
 *    setiap kali app dibuka (load) DAN setiap kali kembali ke foreground
 *    (visibilitychange → visible). Tanpa ini kita bergantung pada kebijakan
 *    interval browser yang malas (iOS bisa 24 jam untuk sw.js).
 * 2. Deteksi SW baru: `onupdatefound` → SW baru `installing`, lalu tunggu
 *    state `installed`/`waiting`. Karena kita memakai registerType "prompt",
 *    SW baru TIDAK aktif sendiri — ia menunggu sampai user menekan tombol
 *    "Perbarui" di UpdateToast.
 * 3. `applyUpdate()` — kirim pesan SKIP_WAITING ke SW yang menunggu agar ia
 *    aktif dan mengambil kendali (skipWaiting + clients.claim di sw.ts),
 *    lalu reload halaman saat `controllerchange` → semua aset versi terbaru
 *    dimuat. Bekerja di Android maupun iOS home-screen PWA.
 *
 * Referensi: https://vite-pwa-org.netlify.app/guide/service-worker.html
 */

type Listener = (sudahSiap: boolean) => void;

let registration: ServiceWorkerRegistration | null = null;
let versiBaruSiap = false;
let pernahPunyaController = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(versiBaruSiap);
}

/** Berlangganan status "ada versi baru". Return fungsi unsubscribe. */
export function onVersiBaru(listener: Listener): () => void {
  listeners.add(listener);
  listener(versiBaruSiap);
  return () => {
    listeners.delete(listener);
  };
}

/** Ada versi baru yang sudah ter-install dan siap (menunggu reload). */
export function adaVersiBaru(): boolean {
  return versiBaruSiap;
}

/**
 * Terapkan versi baru: aktifkan SW yang menunggu, lalu reload.
 *
 * Alur: kirim pesan SKIP_WAITING → SW waiting memanggil skipWaiting() →
 * event `activate` → clients.claim() → controllerchange terpicu di halaman →
 * reload penuh memuat aset versi terbaru.
 */
export function applyUpdate(): void {
  const sw = registration?.waiting ?? registration?.installing;
  if (sw) {
    // Tunggu controllerchange sebagai jaring pengaman: kalau reload manual
    // terjadi lebih dulu (mis. user menutup app) tidak masalah — SW baru
    // tetap akan mengambil kendali di muat berikutnya.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    }, { once: true });
    sw.postMessage({ type: 'SKIP_WAITING' });
    // Fallback: bila dalam 3 detik controllerchange tidak terjadi (SW lambat
    // aktif, atau pesan hilang), reload tetap dilakukan — aset versi baru
    // biasanya sudah ter-precache oleh SW yang sudah aktif.
    window.setTimeout(() => window.location.reload(), 3000);
  } else {
    // Tidak ada SW waiting (mis. toast tersisa dari kondisi aneh) — reload
    // saja; registrasi akan mengecek versi terbaru saat app dimuat ulang.
    window.location.reload();
  }
}

/** Cek paksa ke server: ada sw.js yang berbeda atau tidak. */
export async function cekUpdateSekarang(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    // offline / gagal fetch — abaikan, coba lagi di trigger berikutnya
  }
}

function tandaiVersiBaru(): void {
  if (versiBaruSiap) return;
  versiBaruSiap = true;
  notify();
}

function amatiRegistration(reg: ServiceWorkerRegistration): void {
  registration = reg;

  // SW baru sedang install saat halaman ini hidup.
  if (reg.installing && reg.installing.state === 'installing') {
    reg.installing.addEventListener('statechange', function onState(e) {
      const sw = e.target as ServiceWorker;
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        // controller ada → ini BUKAN install pertama → ada versi baru.
        tandaiVersiBaru();
      }
      sw.removeEventListener('statechange', onState);
    });
  }

  // SW baru sudah masuk tanpa halaman tahu (mis. terpasang saat app standby,
  // lalu halaman dibuka lagi): waiting+controller = siap menunggu reload.
  if (reg.waiting && navigator.serviceWorker.controller) {
    tandaiVersiBaru();
  }

  // Kalau SW baru sudah langsung active (mis. update dari tab lain yang
  // menekan Perbarui, atau SW eksternal), perlakukan sebagai versi baru.
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', function onState(e) {
      const target = e.target as ServiceWorker;
      if (target.state === 'installed' && navigator.serviceWorker.controller) {
        tandaiVersiBaru();
      }
      if (target.state === 'activated' && navigator.serviceWorker.controller) {
        // SW baru sudah mengambil kendali (mis. dikirim SKIP_WAITING dari tab
        // lain, atau SW aktif tanpa waiting). Versi baru perlu reload — tawarkan
        // lewat toast.
        tandaiVersiBaru();
      }
      target.removeEventListener('statechange', onState);
    });
  });

  // SW lain mengambil kendali di tengah sesi (mis. update diterapkan dari tab
  // lain). Jangan reload otomatis di sini — biarkan user menekan Perbarui.
  // Guard `pernahPunyaController`: saat SW PERTAMA mengambil kendali (install
  // awal + clients.claim), controllerchange juga terpicu padahal bukan versi
  // baru — tanpa guard, toast "versi baru" muncul palsu di kunjungan pertama.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pernahPunyaController && !versiBaruSiap) tandaiVersiBaru();
    pernahPunyaController = true;
  });
}

/**
 * Pasang semua mekanisme update. Dipanggil sekali dari App useEffect.
 * Aman dipanggil di environment tanpa SW (browser lama).
 */
export function initAppUpdate(): void {
  if (!('serviceWorker' in navigator)) return;

  void navigator.serviceWorker.ready.then(amatiRegistration);

  // 1) Cek saat app dibuka.
  window.addEventListener('load', () => void cekUpdateSekarang());

  // 2) Cek setiap app kembali ke foreground (dari standby!) — inilah kasus
  //    utama user yang tidak pernah "memuat ulang" app-nya.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void cekUpdateSekarang();
  });

  // 3) Koneksi kembali online — momen alami untuk sinkron versi.
  window.addEventListener('online', () => void cekUpdateSekarang());
}
