import { useCallback, useEffect, useState } from 'react';
import {
  getPushBlocker,
  describePushBlocker,
  enablePush,
  notificationPermission,
} from '../../lib/push/subscribe';
import { useInstallPrompt } from '../../lib/push/installPrompt';
import { getPlatform, isStandaloneNow } from '../../lib/session';

interface Props {
  open: boolean;
  onClose: () => void;
  reguId: string | undefined;
  /** Dipanggil setelah aktivasi sukses (memulai reminder lokal & ubah status banner). */
  onEnabled: () => void;
}

type StepState = 'ok' | 'fail' | 'pending';

const TEST_TITLE = 'SIPLAP aktif ✅';
const TEST_BODY = 'Pemberitahuan laporan baru akan masuk otomatis.';

/** Kirim notifikasi tes via SW; fallback Notification biasa bila SW belum siap. */
async function showTestNotification(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(TEST_TITLE, {
        body: TEST_BODY,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'siplap-test',
      });
      return;
    }
  } catch {
    /* fallback di bawah */
  }
  new Notification(TEST_TITLE, { body: TEST_BODY, icon: '/icons/icon-192.png' });
}

/**
 * Modal interaktif aktivasi notifikasi.
 * - Diagnosa dukungan perangkat SEBELUM meminta izin (agar pesan tidak menipu).
 * - Tombol "Pasang App" 1-tap di Android (beforeinstallprompt).
 * - Panduan perbaikan berbeda untuk Android vs iOS, tergantung di mana user macet.
 */
export default function PushSetupModal({ open, onClose, reguId, onEnabled }: Props) {
  const platform = getPlatform();
  const isAndroid = platform === 'android';
  const isIos = platform === 'ios';

  const { canInstall, promptInstall } = useInstallPrompt();
  const [standalone, setStandalone] = useState(isStandaloneNow());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    notificationPermission(),
  );
  const [blocker, setBlocker] = useState(() => getPushBlocker());

  // Segarkan status izin/dukungan tiap kali modal dibuka (izin bisa berubah
  // dari luar app — user baru saja mengubahnya di Pengaturan Android).
  useEffect(() => {
    if (!open) return;
    setPerm(notificationPermission());
    setBlocker(getPushBlocker());
    setStandalone(isStandaloneNow());
    setError(null);
    setDone(false);
  }, [open]);

  // Deteksi app baru saja terpasang.
  useEffect(() => {
    const onChange = () => setStandalone(isStandaloneNow());
    window.addEventListener('appinstalled', onChange);
    return () => window.removeEventListener('appinstalled', onChange);
  }, []);

  const handleActivate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePush(reguId);
      setPerm(notificationPermission());
      setDone(true);
      onEnabled();
      // Notifikasi tes langsung: bukti nyata ke user bahwa notifikasi JALAN.
      await showTestNotification();
    } catch (err) {
      setPerm(notificationPermission());
      setBlocker(getPushBlocker());
      setError(err instanceof Error ? err.message : 'Gagal mengaktifkan notifikasi.');
    } finally {
      setBusy(false);
    }
  }, [reguId, onEnabled]);

  if (!open) return null;

  const browserBlocked =
    blocker === 'no-push' || blocker === 'no-notification' || blocker === 'no-service-worker';

  const steps: Array<{ key: string; label: string; state: StepState }> = [
    {
      key: 'https',
      label: 'Koneksi aman (HTTPS)',
      state: blocker === 'insecure-context' ? 'fail' : 'ok',
    },
    {
      key: 'browser',
      label: isIos
        ? 'Safari iOS 16.4+ (app terpasang)'
        : 'Browser mendukung Web Push',
      state: browserBlocked ? 'fail' : 'ok',
    },
    {
      key: 'izin',
      label: 'Izin notifikasi diizinkan',
      state: perm === 'granted' ? 'ok' : perm === 'denied' ? 'fail' : 'pending',
    },
    {
      key: 'server',
      label: 'Perangkat terdaftar di server',
      state: done ? 'ok' : 'pending',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Aktivasi notifikasi"
      onClick={onClose}
    >
      <div
        className="anim-rise max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-navy-600/70 bg-navy-900 p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle geser (mobile) */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-navy-600 sm:hidden" />

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Notifikasi</div>
            <h2 className="text-lg font-bold leading-tight">Aktifkan notifikasi</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-navy-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Status per langkah */}
        <div className="mt-4 space-y-2">
          {steps.map((s) => (
            <div
              key={s.key}
              className={
                'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ' +
                (s.state === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : s.state === 'fail'
                    ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : 'border-navy-600/60 bg-navy-800/60 text-slate-400')
              }
            >
              <span>{s.state === 'ok' ? '✅' : s.state === 'fail' ? '❌' : '⏳'}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Browser/WebView tidak mendukung push (umum di WebView Android) */}
        {browserBlocked && (
          <div className="mt-4 rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2.5 text-[13px] leading-relaxed text-gold-200">
            {describePushBlocker(blocker)}
          </div>
        )}

        {/* Android: CTA pasang app bila tersedia */}
        {isAndroid && canInstall && (
          <button
            onClick={() => void promptInstall()}
            className="btn-secondary mt-4 w-full py-3"
          >
            📲 Pasang SIPLAP ke Home Screen
          </button>
        )}

        {/* Tombol aktivasi utama */}
        {!blocker && perm !== 'granted' && (
          <button
            onClick={() => void handleActivate()}
            disabled={busy}
            className="btn-primary mt-4 w-full py-3.5"
          >
            {busy ? 'Memproses…' : '🔔 Izinkan Notifikasi'}
          </button>
        )}

        {/* Izin sudah granted tapi belum terdaftar ke server */}
        {perm === 'granted' && !done && !blocker && (
          <button
            onClick={() => void handleActivate()}
            disabled={busy}
            className="btn-primary mt-4 w-full py-3.5"
          >
            {busy ? 'Memproses…' : 'Daftarkan perangkat'}
          </button>
        )}

        {/* Sukses */}
        {done && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
            ✅ <b>Notifikasi aktif!</b> Notifikasi tes sudah dikirim. Jika tidak muncul,
            pastikan notifikasi diaktifkan di Pengaturan → Aplikasi → SIPLAP/Chrome.
            <button onClick={onClose} className="btn-primary mt-3 w-full py-2.5 text-sm">
              Selesai
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-red-300">
            {error}
          </div>
        )}

        {/* Panduan troubleshooting per platform */}
        {perm === 'denied' && (
          <div className="mt-4 rounded-xl border border-navy-600/60 bg-navy-800/60 px-3 py-3 text-[13px] leading-relaxed text-slate-300">
            <b className="text-white">Izin diblokir — cara membuka:</b>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              {isAndroid ? (
                <>
                  <li>
                    Sentuh ikon 🔒 di address bar → <b>Izin</b> → <b>Notifikasi</b> → Izinkan
                  </li>
                  <li>
                    Atau: tahan ikon Chrome → <b>(i) Info aplikasi</b> → <b>Notifikasi</b> aktif
                  </li>
                  <li>Muat ulang halaman ini</li>
                </>
              ) : (
                <>
                  <li>
                    Buka <b>Pengaturan</b> iPhone → Safari → <b>Notifikasi SIPLAP</b> → Izinkan
                  </li>
                  <li>
                    Atau hapus SIPLAP dari Home Screen, pasang ulang via Share → Add to Home
                    Screen
                  </li>
                </>
              )}
            </ol>
          </div>
        )}

        {/* Catatan iOS: wajib terpasang ke home screen */}
        {isIos && !standalone && (
          <div className="mt-4 rounded-xl border border-navy-600/60 bg-navy-800/60 px-3 py-3 text-[13px] leading-relaxed text-slate-300">
            <b className="text-white">Di iPhone, notifikasi hanya jalan bila app terpasang:</b>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>
                Buka menu <b>Share</b> ⬆️ di Safari
              </li>
              <li>
                Pilih <b>Add to Home Screen</b>
              </li>
              <li>Buka SIPLAP dari ikon Home Screen, ulangi aktivasi</li>
            </ol>
          </div>
        )}

        {/* Catatan Android: rekomendasi pasang agar push lebih andal */}
        {isAndroid && !standalone && !browserBlocked && (
          <p className="mt-4 text-[12px] leading-relaxed text-slate-400">
            💡 Tips: pasang SIPLAP ke Home Screen agar pengingat lebih andal terkirim walau
            app ditutup.
          </p>
        )}
      </div>
    </div>
  );
}
