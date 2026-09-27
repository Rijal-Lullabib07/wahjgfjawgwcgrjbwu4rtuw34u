import { useCallback, useEffect, useState } from "react";
import type { Laporan, TahapLaporan } from "../../types";
import { TAHAP_LABEL } from "../../types";
import {
  fetchLaporanThread,
  fotoUrl,
  namaFileUnduhan,
  unduhFileStorage,
  videoUrl,
} from "../../lib/supabase/api";
import {
  formatKoordinat,
  formatTanggal,
  formatWaktu,
} from "../../lib/cycle";
import { reguOrigin } from "../../lib/regu";
import { salinTeks } from "../../lib/clipboard";
import { exportThreadPdf } from "./exportThreadPdf";
import PlaceBadge from "../../components/PlaceBadge";

interface Props {
  rootId: string;
  onBack: () => void;
  /** Lanjutkan rangkaian (buka form turunan). */
  onLanjutkan?: () => void;
}

const TAHAP_BADGE: Record<TahapLaporan, string> = {
  awal: "bg-sky-500/15 text-sky-300",
  update: "bg-amber-500/15 text-amber-300",
  lengkap: "bg-emerald-500/15 text-emerald-300",
};

/** Tombol unduh file Storage (blob → dialog simpan). */
function UnduhButton({ storagePath }: { storagePath: string }) {
  const [state, setState] = useState<"idle" | "proses" | "gagal">("idle");
  const unduh = async () => {
    setState("proses");
    try {
      await unduhFileStorage(storagePath, namaFileUnduhan(storagePath));
      setState("idle");
    } catch {
      setState("gagal");
      window.setTimeout(() => setState("idle"), 2000);
    }
  };
  return (
    <button
      type="button"
      disabled={state === "proses"}
      onClick={() => void unduh()}
      className="block w-full border-t border-navy-700 px-2 py-1 text-center text-[11px] font-semibold text-sky-300 transition hover:bg-navy-800 hover:text-white disabled:opacity-60"
    >
      {state === "proses"
        ? "⏳ Mengunduh…"
        : state === "gagal"
          ? "⚠ Gagal — coba lagi"
          : "⬇ Unduh"}
    </button>
  );
}

/** Tombol salin narasi (uraian) satu tahap ke clipboard — API modern + fallback lama. */
function SalinNarasiButton({ narasi }: { narasi: string }) {
  const [status, setStatus] = useState<"idle" | "ok" | "gagal">("idle");

  const salin = async () => {
    const ok = await salinTeks(narasi);
    setStatus(ok ? "ok" : "gagal");
    window.setTimeout(() => setStatus("idle"), 2000);
  };

  return (
    <button
      type="button"
      onClick={() => void salin()}
      className={
        "shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition " +
        (status === "ok"
          ? "border-emerald-500/40 text-emerald-300"
          : status === "gagal"
            ? "border-red-500/40 text-red-300"
            : "border-white/10 text-slate-400 hover:border-sky-400/40 hover:text-sky-300")
      }
    >
      {status === "ok"
        ? "Tersalin ✓"
        : status === "gagal"
          ? "Gagal salin"
          : "📋 Salin narasi"}
    </button>
  );
}

/** Satu entri rangkaian (tahap) dengan foto & video. */
function TahapSection({ laporan, nomor }: { laporan: Laporan; nomor: string }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-700/70 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-gold-400/15 px-2 py-0.5 text-xs font-extrabold text-gold-300">
            {nomor}
          </span>
          <h3 className="text-sm font-bold text-white">
            {TAHAP_LABEL[laporan.tahap]}
          </h3>
        </div>
        <span className={"badge " + TAHAP_BADGE[laporan.tahap]}>
          {formatTanggal(laporan.timestamp_kirim)} · {formatWaktu(laporan.timestamp_kirim)} WIB
        </span>
      </div>

      {laporan.catatan && (
        <div className="mt-3 rounded-xl border border-white/5 bg-navy-950/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              Uraian
            </div>
            <SalinNarasiButton narasi={laporan.catatan} />
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">
            {laporan.catatan}
          </p>
        </div>
      )}

      {(laporan.fotos?.length ?? 0) > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {laporan.fotos!.map((foto) => (
            <div
              key={foto.id}
              className="overflow-hidden rounded-lg border border-navy-700"
            >
              <a href={fotoUrl(foto.storage_path)} target="_blank" rel="noreferrer">
                <img
                  src={fotoUrl(foto.storage_path)}
                  alt={`Foto ${foto.urutan_foto}`}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </a>
              <UnduhButton storagePath={foto.storage_path} />
            </div>
          ))}
        </div>
      )}

      {(laporan.videos?.length ?? 0) > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {laporan.videos!.map((video) => (
            <div
              key={video.id}
              className="overflow-hidden rounded-lg border border-sky-500/30 bg-black"
            >
              <video
                src={videoUrl(video.storage_path)}
                controls
                preload="metadata"
                className="aspect-video w-full object-cover"
              />
              <div className="flex items-center justify-between gap-2 border-t border-navy-700 bg-navy-900 px-2 py-1">
                <span className="text-[10px] text-sky-200">
                  🎥 Video
                  {video.duration_seconds ? ` · ${video.duration_seconds} detik` : ""}
                </span>
                <UnduhButton storagePath={video.storage_path} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <PlaceBadge lat={laporan.latitude} lng={laporan.longitude} />
      </div>
    </section>
  );
}

/**
 * Tampilan formal satu rangkaian laporan — seperti dokumen resmi:
 * kop identitas, ringkasan, lalu uraian per tahap (Laporan Awal →
 * Update Situasi → Laporan Lengkap) lengkap dengan foto/video.
 * Dapat diekspor ke PDF.
 */
export default function LaporanThreadDetail({ rootId, onBack, onLanjutkan }: Props) {
  const [entries, setEntries] = useState<Laporan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPdf, setBusyPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await fetchLaporanThread(rootId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rootId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
        <button onClick={onBack} className="btn-secondary mb-4 px-3 py-2 text-sm">
          ← Kembali
        </button>
        <div className="card border-red-500/30 text-sm text-red-300">
          {error}
          <button
            onClick={() => void load()}
            className="ml-3 underline hover:no-underline"
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (entries === null || entries.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
        <button onClick={onBack} className="btn-secondary mb-4 px-3 py-2 text-sm">
          ← Kembali
        </button>
        <div className="card text-sm text-slate-400">
          {entries === null ? "Memuat dokumen laporan…" : "Laporan tidak ditemukan."}
        </div>
      </div>
    );
  }

  const root = entries.find((l) => l.id === rootId) ?? entries[0];
  const terbaru = entries[entries.length - 1];
  const totalFoto = entries.reduce((a, l) => a + (l.fotos?.length ?? 0), 0);
  const totalVideo = entries.reduce((a, l) => a + (l.videos?.length ?? 0), 0);
  const nomorDokumen = `LAP/${root.id.slice(0, 8).toUpperCase()}/${new Date(
    root.timestamp_kirim,
  ).getFullYear()}`;
  const masihTerbuka = terbaru.tahap !== "lengkap";

  const unduhPdf = async () => {
    setBusyPdf(true);
    setPdfError(null);
    try {
      await exportThreadPdf(entries, root);
    } catch (e) {
      setPdfError(
        e instanceof Error ? `Gagal membuat PDF: ${e.message}` : "Gagal membuat PDF.",
      );
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5 sm:px-6">
      {/* Header navigasi */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="btn-secondary px-3 py-2 text-sm">
          ← Kembali
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => void unduhPdf()}
            disabled={busyPdf}
            className="btn-primary px-3 py-2 text-sm"
          >
            {busyPdf ? "⏳ Membuat…" : "📄 Unduh PDF"}
          </button>
          {masihTerbuka && onLanjutkan && (
            <button onClick={onLanjutkan} className="btn-secondary px-3 py-2 text-sm">
              ➕ Lanjutkan
            </button>
          )}
        </div>
      </div>

      {pdfError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {pdfError}
        </div>
      )}

      {/* ===== Kop dokumen formal ===== */}
      <div className="card border-gold-400/25">
        <div className="border-b border-navy-700/70 pb-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-gold-400">
            Kepolisian Negara Republik Indonesia
          </div>
          <div className="mt-1 text-lg font-extrabold tracking-tight text-white">
            POLRES PURWAKARTA
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            Pelaporan Giat Lapangan — SALAM PRESISI
          </div>
        </div>

        <div className="mt-3 text-center">
          <div className="text-sm font-extrabold uppercase tracking-wide text-white">
            {root.kategori === "kejadian" ? "Laporan Kejadian" : "Laporan Kegiatan"}
          </div>
          <div className="mono mt-1 text-xs text-slate-400">
            No. {nomorDokumen}
          </div>
          {masihTerbuka ? (
            <span className="badge mt-2 bg-amber-500/15 text-amber-300">
              ⏳ Rangkaian berjalan — {TAHAP_LABEL[terbaru.tahap]}
            </span>
          ) : (
            <span className="badge mt-2 bg-emerald-500/15 text-emerald-300">
              ✓ {TAHAP_LABEL.lengkap} — rangkaian tertutup
            </span>
          )}
        </div>

        <div className="mt-3 divide-y divide-navy-700/50 border-t border-navy-700/70 pt-2">
          <BarisData
            label="Pelapor"
            value={
              root.regu
                ? `${root.regu.nama_regu} — ${reguOrigin(root.regu)}`
                : root.regu_id
            }
          />
          <BarisData
            label="Jenis"
            value={root.jenis?.nama ?? (root.kategori === "kejadian" ? "Kejadian" : "Kegiatan")}
          />
          <BarisData label="Perihal" value={root.perihal ?? "—"} />
          <BarisData
            label="Tanggal awal"
            value={`${formatTanggal(root.timestamp_kirim)}, ${formatWaktu(root.timestamp_kirim)} WIB`}
          />
          <BarisData
            label="Pembaruan terakhir"
            value={`${formatTanggal(terbaru.timestamp_kirim)}, ${formatWaktu(terbaru.timestamp_kirim)} WIB`}
          />
          <BarisData
            label="Lokasi"
            value={
              <span className="flex flex-wrap items-center gap-2">
                <span className="mono text-xs">
                  {formatKoordinat(root.latitude, root.longitude)}
                </span>
                <PlaceBadge lat={root.latitude} lng={root.longitude} />
              </span>
            }
          />
          <BarisData
            label="Lampiran"
            value={`${entries.length} tahap · ${totalFoto} foto · ${totalVideo} video`}
          />
        </div>
      </div>

      {/* ===== Isi per tahap ===== */}
      <div className="space-y-3">
        <div className="eyebrow px-1">Uraian rangkaian</div>
        {entries.map((l, i) => (
          <TahapSection key={l.id} laporan={l} nomor={ROMAWI[i] ?? String(i + 1)} />
        ))}
      </div>

      {/* ===== Penutup ===== */}
      <div className="card text-center">
        <p className="text-xs leading-5 text-slate-400">
          Demikian laporan ini dibuat secara bertanggung jawab untuk dipergunakan
          sebagaimana mestinya.
        </p>
        <div className="mt-4 text-xs text-slate-500">
          Purwakarta, {formatTanggal(terbaru.timestamp_kirim)}
        </div>
        <div className="mt-1 text-sm font-semibold text-slate-300">
          {root.regu?.nama_regu ?? "Pelapor"}
        </div>
        <div className="mt-8 border-t border-dashed border-navy-600 pt-1 text-[10px] text-slate-600">
          tanda tangan & nama jelas
        </div>
      </div>
    </div>
  );
}

function BarisData({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-32 shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:w-36">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm text-slate-200">{value}</span>
    </div>
  );
}

const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
