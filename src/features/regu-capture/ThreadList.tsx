import { useCallback, useEffect, useState } from "react";
import type { KategoriLaporan, Laporan, TahapLaporan } from "../../types";
import { TAHAP_LABEL } from "../../types";
import { fetchOpenThreads } from "../../lib/supabase/api";
import { formatWaktu } from "../../lib/cycle";
import LaporanThreadDetail from "./LaporanThreadDetail";

interface ParentPilihan {
  id: string;
  kategori: KategoriLaporan;
  perihal?: string | null;
  namaJenis?: string | null;
  tahapBerikut: TahapLaporan;
}

interface Props {
  reguId: string;
  refreshKey: number;
  onLanjutkan: (parent: ParentPilihan) => void;
  onLaporBaru: () => void;
}

/** Tahap berikutnya dalam rangkaian (kegiatan: awal→lengkap; kejadian: awal→update→lengkap). */
function tahapBerikutOf(tahap: TahapLaporan, kategori: KategoriLaporan): TahapLaporan {
  if (tahap === "awal") return kategori === "kejadian" ? "update" : "lengkap";
  return "lengkap";
}

const TAHAP_BADGE: Record<TahapLaporan, string> = {
  awal: "bg-sky-500/15 text-sky-300",
  update: "bg-amber-500/15 text-amber-300",
  lengkap: "bg-emerald-500/15 text-emerald-300",
};

/**
 * Daftar rangkaian laporan milik pelapor: laporan awal yang masih
 * terbuka (bisa dilanjutkan) + riwayat yang sudah lengkap.
 */
export default function ThreadList({
  reguId,
  refreshKey,
  onLanjutkan,
  onLaporBaru,
}: Props) {
  const [threads, setThreads] = useState<Array<
    Laporan & { child_count: number }
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Id rangkaian yang dibuka di tampilan formal (null = daftar). */
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reguId) return;
    try {
      setThreads(await fetchOpenThreads(reguId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reguId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Tampilan detail formal — menimpa daftar selama terbuka.
  if (openThreadId) {
    return (
      <LaporanThreadDetail
        rootId={openThreadId}
        onBack={() => {
          setOpenThreadId(null);
          void load();
        }}
        onLanjutkan={
          (() => {
            const t = (threads ?? []).find((x) => x.id === openThreadId);
            if (!t || t.tahap === "lengkap") return undefined;
            return () =>
              onLanjutkan({
                id: t.id,
                kategori: t.kategori,
                perihal: t.perihal,
                namaJenis: t.jenis?.nama ?? null,
                tahapBerikut: tahapBerikutOf(t.tahap, t.kategori),
              });
          })()
        }
      />
    );
  }

  const terbuka = (threads ?? []).filter((t) => t.tahap !== "lengkap");
  const selesai = (threads ?? []).filter((t) => t.tahap === "lengkap");

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Rangkaian laporan saya</div>
          <h2 className="mt-1 text-lg font-extrabold text-white">
            Laporan berjalan
          </h2>
        </div>
        <button onClick={onLaporBaru} className="btn-primary px-4 py-2 text-sm">
          + Lapor baru
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
          <button
            onClick={() => void load()}
            className="ml-3 underline hover:no-underline"
          >
            Coba lagi
          </button>
        </div>
      )}

      {threads === null && !error && (
        <div className="card text-sm text-slate-400">Memuat rangkaian…</div>
      )}

      {threads !== null && terbuka.length === 0 && selesai.length === 0 && (
        <div className="card text-sm text-slate-400">
          Belum ada laporan. Tekan <b>+ Lapor baru</b> untuk mulai melaporkan
          kegiatan atau kejadian.
        </div>
      )}

      {/* Rangkaian terbuka — bisa dilanjutkan */}
      {terbuka.length > 0 && (
        <section className="space-y-3">
          <div className="eyebrow">Perlu dilanjutkan</div>
          {terbuka.map((t) => {
            const berikut = tahapBerikutOf(t.tahap, t.kategori);
            return (
              <div
                key={t.id}
                className="card cursor-pointer transition hover:border-gold-400/40"
                onClick={() => setOpenThreadId(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setOpenThreadId(t.id);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-white">
                      {t.jenis?.nama ?? (t.kategori === "kejadian" ? "Kejadian" : "Kegiatan")}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {t.kategori === "kejadian" ? "⚡ Kejadian" : "📋 Kegiatan"} ·{" "}
                      {formatWaktu(t.timestamp_kirim)}
                    </div>
                  </div>
                  <span className={"badge " + TAHAP_BADGE[t.tahap]}>
                    {TAHAP_LABEL[t.tahap]}
                  </span>
                </div>
                {t.perihal && (
                  <p className="mt-2 line-clamp-2 text-xs text-slate-400">
                    {t.perihal}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">
                    {t.child_count > 0
                      ? `${t.child_count} update terkirim`
                      : "Belum ada update"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenThreadId(t.id);
                      }}
                      className="rounded-xl border border-navy-600 px-3 py-2 text-xs font-semibold text-sky-300 transition hover:bg-navy-800 hover:text-white"
                    >
                      👁 Lihat
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onLanjutkan({
                          id: t.id,
                          kategori: t.kategori,
                          perihal: t.perihal,
                          namaJenis: t.jenis?.nama ?? null,
                          tahapBerikut: berikut,
                        });
                      }}
                      className="btn-primary px-4 py-2 text-xs"
                    >
                      ➕ {TAHAP_LABEL[berikut]}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Sudah lengkap */}
      {selesai.length > 0 && (
        <section className="space-y-3">
          <div className="eyebrow">Sudah lengkap</div>
          {selesai.map((t) => (
            <div
              key={t.id}
              className="card cursor-pointer border-emerald-500/20 bg-emerald-500/[0.03] transition hover:border-emerald-400/40"
              onClick={() => setOpenThreadId(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setOpenThreadId(t.id);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-200">
                    {t.jenis?.nama ?? (t.kategori === "kejadian" ? "Kejadian" : "Kegiatan")}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatWaktu(t.timestamp_kirim)}
                  </div>
                </div>
                <span className="badge bg-emerald-500/15 text-emerald-300">
                  ✓ {TAHAP_LABEL.lengkap}
                </span>
              </div>
              {t.perihal && (
                <p className="mt-2 line-clamp-2 text-xs text-slate-400">{t.perihal}</p>
              )}
              <div className="mt-2 text-[11px] font-semibold text-sky-300">
                👁 Lihat laporan formal
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
