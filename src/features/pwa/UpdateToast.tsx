import { useEffect, useState } from 'react';
import { applyUpdate, onVersiBaru } from '../../lib/pwa/appUpdate';

/**
 * Toast "Versi baru tersedia" — muncul ketika service worker versi baru
 * sudah siap. Tombol Perbarui me-reload app dan versi baru langsung jalan.
 * Auto-hide tidak dipakai: biar user tidak kehabisan kesempatan memperbarui;
 * toast ikut hilang saat app dimuat ulang.
 */
export default function UpdateToast() {
  const [tampil, setTampil] = useState(false);

  useEffect(() => onVersiBaru((siap) => setTampil(siap)), []);

  if (!tampil) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-24 z-[60] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
      role="status"
    >
      <div className="card flex items-center gap-3 border-amber-300/60 bg-slate-900/95 px-4 py-3 shadow-xl backdrop-blur">
        <span className="text-xl" aria-hidden>
          🆕
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white">Versi baru tersedia</div>
          <div className="truncate text-xs text-slate-300">
            Perbarui untuk mendapatkan fitur & perbaikan terbaru.
          </div>
        </div>
        <button
          onClick={applyUpdate}
          className="btn-primary shrink-0 px-4 py-2 text-xs"
        >
          Perbarui
        </button>
      </div>
    </div>
  );
}
