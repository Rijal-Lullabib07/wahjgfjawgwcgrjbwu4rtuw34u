import { useCallback, useEffect, useState } from "react";
import type { QueuedLaporan } from "../../types";
import { queueGetAll, queueDelete } from "../../lib/offline-sync/db";
import { syncPendingLaporan } from "../../lib/offline-sync/syncManager";
import { formatKoordinat } from "../../lib/cycle";

interface Props {
  onQueueChanged: () => Promise<void> | void;
}

const STATUS_STYLE: Record<
  QueuedLaporan["status"],
  { label: string; cls: string }
> = {
  pending: {
    label: "⏳ Tersimpan lokal",
    cls: "bg-amber-500/15 text-amber-300",
  },
  syncing: { label: "🔄 Mengirim…", cls: "bg-sky-500/15 text-sky-300" },
  failed: { label: "⚠️ Gagal kirim", cls: "bg-red-500/15 text-red-300" },
};

/** Daftar antrian laporan offline + tombol sync manual + hapus. */
export default function QueueList({ onQueueChanged }: Props) {
  const [items, setItems] = useState<QueuedLaporan[]>([]);

  const refresh = useCallback(async () => {
    const all = await queueGetAll();
    setItems(
      all.sort((a, b) => b.timestampKirim.localeCompare(a.timestampKirim)),
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSync = async () => {
    const r = await syncPendingLaporan();
    await refresh();
    await onQueueChanged();
    if (r.synced > 0) {
      alert(r.synced + " laporan berhasil terkirim");
    } else if (r.failed > 0) {
      alert(
        "Gagal mengirim " +
          r.failed +
          " laporan — akan dicoba ulang otomatis saat online.",
      );
    } else {
      alert("Tidak ada antrian untuk dikirim.");
    }
  };

  const handleDelete = async (localId: string) => {
    if (
      !confirm(
        "Hapus laporan dari antrian? Foto yang belum terkirim akan hilang.",
      )
    )
      return;
    await queueDelete(localId);
    await refresh();
    await onQueueChanged();
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="mb-3 text-5xl">📦</div>
        <h2 className="font-semibold">Antrian kosong</h2>
        <p className="mt-1 max-w-xs text-sm text-slate-400">
          Laporan yang gagal terkirim karena offline akan tersimpan di sini dan
          otomatis terkirim ulang saat koneksi kembali.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-4 pb-32">
      <button
        onClick={() => void handleSync()}
        className="btn-primary w-full py-3.5"
      >
        🔄 Coba Kirim Ulang Semua
      </button>

      {items.map((item) => {
        const st = STATUS_STYLE[item.status] ?? STATUS_STYLE.pending;
        return (
          <div key={item.localId} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Laporan</div>
                <div className="text-xs text-slate-400">
                  {new Date(item.timestampKirim).toLocaleString("id-ID")}
                </div>
              </div>
              <span className={"badge " + st.cls}>{st.label}</span>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              📷 {item.fotos.length} foto · 🎥 {(item.videos ?? []).length}{" "}
              video · 📍 {formatKoordinat(item.latitude, item.longitude)}
            </div>
            {item.lastError && (
              <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {item.lastError} (percobaan ke-{item.attempts})
              </div>
            )}
            {item.status === "failed" && (
              <button
                onClick={() => void handleDelete(item.localId)}
                className="mt-3 text-xs font-semibold text-red-400 underline"
              >
                Hapus dari antrian
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
