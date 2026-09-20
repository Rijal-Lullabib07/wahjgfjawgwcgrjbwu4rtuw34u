import { useEffect } from "react";

export interface ReportPopupData {
  title: string;
  body: string;
  folderKey: string | null;
  laporanId?: string;
}

interface Props {
  popup: ReportPopupData | null;
  onOpen: (folderKey: string) => void;
  onClose: () => void;
}

/**
 * Popup "Laporan baru masuk" di dalam app — bunyi & getar dipicu pemanggil.
 * Tombol "Buka laporan" membuka folder yang benar di tab 📁 Folder.
 */
export default function ReportPopup({ popup, onOpen, onClose }: Props) {
  useEffect(() => {
    if (!popup) return;
    const timer = setTimeout(onClose, 20_000);
    return () => clearTimeout(timer);
  }, [popup, onClose]);

  if (!popup) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-24 sm:pb-8">
      <div
        role="alertdialog"
        aria-live="assertive"
        className="mx-auto max-w-md rounded-2xl border border-gold-400/60 bg-navy-900/95 p-4 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">📥</span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-gold-300">
              Laporan baru masuk
            </div>
            <div className="mt-0.5 truncate text-sm font-bold text-white">
              {popup.title}
            </div>
            {popup.body && (
              <div className="mt-0.5 line-clamp-2 text-xs text-slate-300">
                {popup.body}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg px-2 py-1 text-slate-500 transition hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {popup.folderKey && (
            <button
              onClick={() => onOpen(popup.folderKey as string)}
              className="flex-1 rounded-xl bg-gold-400 px-4 py-2.5 text-sm font-bold text-navy-900 transition hover:bg-gold-300"
            >
              Buka laporan
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-xl border border-navy-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:text-white"
          >
            Nanti
          </button>
        </div>
      </div>
    </div>
  );
}
