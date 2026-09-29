import { useCallback, useEffect, useMemo, useState } from "react";
import type { KategoriLaporan, Laporan, TahapLaporan } from "../../types";
import { TAHAP_LABEL } from "../../types";
import { fetchOpenThreads } from "../../lib/supabase/api";
import { formatWaktu } from "../../lib/cycle";
import { salinTeks } from "../../lib/clipboard";
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

// ---------- Kata kunci pencarian waktu ----------

const NAMA_HARI = [
  "minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu",
];
const NAMA_BULAN_PANJANG = [
  "januari", "februari", "maret", "april", "mei", "juni",
  "juli", "agustus", "september", "oktober", "november", "desember",
];
const NAMA_BULAN_PENDEK = [
  "jan", "feb", "mar", "apr", "mei", "jun",
  "jul", "agu", "sep", "okt", "nov", "des",
];

/**
 * Semua variasi penulisan waktu untuk pencarian: jam ("16.32", "16:32",
 * "1632"), tanggal ("29 september 2026", "29/9", "29-9-2026"), nama hari,
 * dan periode ("pagi", "siang", "sore", "malam", "subuh", "dini hari").
 * Semua huruf kecil — query pencarian juga di-lowercase sebelum dicocokkan.
 */
function waktuSearchTerms(iso: string): string[] {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [];
  const terms: string[] = [];

  // Jam: 16.32 / 16:32 / 1632
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  terms.push(`${hh}.${mm}`, `${hh}:${mm}`, `${hh}${mm}`);

  // Tanggal: berbagai format
  const tanggal = d.getDate();
  const bulan = d.getMonth() + 1;
  const tahun = d.getFullYear();
  const bPanjang = NAMA_BULAN_PANJANG[d.getMonth()];
  const bPendek = NAMA_BULAN_PENDEK[d.getMonth()];
  terms.push(
    `${tanggal} ${bPanjang} ${tahun}`,
    `${tanggal} ${bPendek} ${tahun}`,
    `${tanggal}/${bulan}/${tahun}`,
    `${tanggal}-${bulan}-${tahun}`,
    `${tanggal}/${bulan}`,
    `${tanggal}-${bulan}`,
  );

  // Hari & periode
  terms.push(NAMA_HARI[d.getDay()]);
  const h = d.getHours();
  if (h >= 4 && h < 10) terms.push("pagi", "subuh");
  else if (h >= 10 && h < 15) terms.push("siang");
  else if (h >= 15 && h < 18) terms.push("sore");
  else if (h >= 18) terms.push("malam");
  else terms.push("dini hari");

  return terms;
}

/** Tombol salin narasi (teks laporan resmi) ke clipboard — API modern + fallback lama. */
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
      onClick={(e) => {
        e.stopPropagation(); // jangan buka detail kartu
        void salin();
      }}
      className={
        "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition " +
        (status === "ok"
          ? "border-emerald-500/40 text-emerald-300"
          : status === "gagal"
            ? "border-red-500/40 text-red-300"
            : "border-navy-600 text-slate-300 hover:border-sky-400/40 hover:text-sky-300")
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

/**
 * Daftar rangkaian laporan milik pelapor: laporan awal yang masih
 * terbuka (bisa dilanjutkan) + riwayat yang sudah lengkap.
 * Memuat 50 laporan awal terbaru; ada pencarian (jenis, perihal,
 * kategori, waktu) dan tombol "Muat lebih banyak".
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
  /** Batas saat ini (50 → 100 → 150) lewat "Muat lebih banyak". */
  const [limit, setLimit] = useState(50);
  /** Kata kunci pencarian — menyaring daftar di sisi klien. */
  const [cari, setCari] = useState("");
  /** Sedang memuat tambahan laporan (tombol "Muat lebih banyak"). */
  const [memuat, setMemuat] = useState(false);

  const load = useCallback(async () => {
    if (!reguId) return;
    try {
      setThreads(await fetchOpenThreads(reguId, limit));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reguId, limit]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Indikator memuat hanya untuk penambahan (bukan pemuatan awal).
  useEffect(() => {
    if (threads !== null) setMemuat(false);
  }, [threads]);

  /**
   * Hasil pencarian: semua kata kunci harus muncul di salah satu
   * field laporan. Cakupan LENGKAP: jenis/insiden, kategori, perihal,
   * narasi lengkap, tahap, NRP pelapor, dan waktu dalam berbagai format
   * (jam "16.32"/"16:32", tanggal "29 september"/"29/9", nama hari,
   * periode "pagi/siang/sore/malam").
   *
   * PENTING: hook ini harus dipanggil SEBELUM early return
   * `if (openThreadId)` di bawah — jumlah hook harus selalu sama
   * di setiap render (React error #300 bila tidak).
   */
  const threadsTersaring = useMemo(() => {
    const query = cari.trim().toLocaleLowerCase("id-ID");
    if (!query) return threads ?? [];
    const terms = query.split(/\s+/).filter(Boolean);
    return (threads ?? []).filter((t) => {
      const searchable = [
        t.jenis?.nama ?? "",
        t.kategori === "kejadian" ? "kejadian" : "kegiatan",
        t.perihal ?? "",
        t.catatan ?? "",
        TAHAP_LABEL[t.tahap],
        t.tahap,
        t.nrp_pelapor ?? "",
        formatWaktu(t.timestamp_kirim),
        t.timestamp_kirim,
        ...waktuSearchTerms(t.timestamp_kirim),
      ]
        .filter((v) => v !== null && v !== undefined && v !== "")
        .join(" ")
        .toLocaleLowerCase("id-ID");
      return terms.every((term) => searchable.includes(term));
    });
  }, [threads, cari]);

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

  const terbuka = threadsTersaring.filter((t) => t.tahap !== "lengkap");
  const selesai = threadsTersaring.filter((t) => t.tahap === "lengkap");
  const totalTampill = (threads ?? []).length;
  const mungkinAdaLagi = totalTampill >= limit;

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-5 pb-32 sm:px-6">
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

      {/* Pencarian — menyaring laporan yang sudah dimuat */}
      {(threads?.length ?? 0) > 0 && (
        <div className="flex gap-2">
          <input
            type="search"
            className="input"
            placeholder="Cari jam, tanggal, insiden, narasi, NRP…"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
          />
          {cari && (
            <button
              type="button"
              className="rounded-xl bg-navy-900 px-3 text-sm text-slate-300 hover:text-white"
              onClick={() => setCari("")}
              aria-label="Hapus pencarian"
            >
              Hapus
            </button>
          )}
        </div>
      )}
      {cari && (
        <p className="text-xs text-slate-500">
          {threadsTersaring.length} dari {threads?.length ?? 0} laporan cocok
          dengan "{cari}".
        </p>
      )}

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
          {cari
            ? `Tidak ada laporan yang cocok dengan pencarian "${cari}".`
            : (
              <>Belum ada laporan. Tekan <b>+ Lapor baru</b> untuk mulai melaporkan
              kegiatan atau kejadian.</>
            )}
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
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-400">
                    {t.perihal}
                  </p>
                )}
                {t.catatan && (
                  <div className="mt-2">
                    <SalinNarasiButton narasi={t.catatan} />
                  </div>
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
                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-400">
                  {t.perihal}
                </p>
              )}
              {t.catatan && <SalinNarasiButton narasi={t.catatan} />}
              <div className="mt-2 text-[11px] font-semibold text-sky-300">
                👁 Lihat laporan formal
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Muat lebih banyak — bila jumlah laporan mencapai batas */}
      {threads !== null && mungkinAdaLagi && (
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            onClick={() => {
              setMemuat(true);
              setLimit((n) => n + 50);
            }}
            disabled={memuat}
            className="rounded-xl border border-navy-600 px-4 py-2 text-xs font-semibold text-sky-300 transition hover:bg-navy-800 hover:text-white disabled:opacity-50"
          >
            {memuat ? "Memuat…" : `⬇ Muat lebih banyak (${totalTampill} dimuat)`}
          </button>
          <span className="text-[11px] text-slate-500">
            Menampilkan {totalTampill} laporan terbaru.
          </span>
        </div>
      )}
    </div>
  );
}
