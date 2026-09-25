import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Laporan, SessionUser } from "../../types";
import {
  fetchLaporan,
  fetchReguList,
  fotoUrl,
  namaFileUnduhan,
  unduhFileStorage,
} from "../../lib/supabase/api";
import { reguDisplayName } from "../../lib/regu";
import PlaceBadge from "../../components/PlaceBadge";
import { exportPdf } from "../report-generator/exportPdf";
import { exportExcel } from "../report-generator/exportExcel";

interface Props {
  refreshKey: number;
  /** rekapMode: tampilkan ringkas + tombol unduh besar (menu Rekap & Unduh). */
  rekapMode?: boolean;
  /** Session pemantau — filter pilihan unit sesuai cakupan (lapisan klien
   *  di atas RLS regu; Kapolsek hanya unit Polseknya, Kasat hanya unit
   *  fungsinya, all = semua). */
  session?: SessionUser | null;
}

/** Cakupan pemantau untuk daftar regu — sama dengan can_read_monitor_scope(). */
function reguDalamCakupan(
  session: SessionUser | null | undefined,
  r: { unit_key?: string | null; wilayah_key?: string | null },
): boolean {
  if (!session) return true;
  const level = session.accessLevel ?? "all";
  if (level === "wilayah") {
    return (session.scopeKey ?? "").trim().toLowerCase() ===
      (r.wilayah_key ?? "").trim().toLowerCase();
  }
  if (level === "fungsi") {
    return (session.scopeKey ?? "").trim().toLowerCase() ===
      (r.unit_key ?? "").trim().toLowerCase();
  }
  return true; // all
}

type Preset = "harian" | "mingguan" | "bulanan" | "custom";
type SortDir = "terbaru" | "terlama";

function presetRange(preset: Preset, custom?: { from: string; to: string }) {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  if (preset === "harian") {
    from.setHours(0, 0, 0, 0);
  } else if (preset === "mingguan") {
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
  } else if (preset === "bulanan") {
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
  } else {
    from.setTime(
      custom ? new Date(custom.from + "T00:00:00").getTime() : from.getTime(),
    );
    if (custom?.to) {
      to.setTime(new Date(custom.to + "T23:59:59").getTime());
    }
  }
  return { from, to };
}

const KATEGORI_BADGE: Record<string, string> = {
  kegiatan: "bg-sky-50 text-sky-700",
  kejadian: "bg-red-50 text-red-700",
};

const TAHAP_LABEL: Record<string, string> = {
  awal: "Awal",
  update: "Update",
  lengkap: "Lengkap",
};

/**
 * Laporan Giat — tabel lengkap ala mockup: pencarian, filter periode
 * (harian/mingguan/bulanan/custom), pelapor, jenis (kegiatan/kejadian),
 * urutan, paginasi, dan kolom Nomor/Waktu/Pelapor/Perihal/Jenis/Lokasi/
 * Dokumentasi/Aksi + preview baris.
 */

/** Tombol unduh foto/video dari Storage via blob agar muncul dialog simpan.
 *  `full` = gaya blok penuh di bawah thumbnail/video dalam modal preview. */
function UnduhMediaButton({
  storagePath,
  full,
}: {
  storagePath: string;
  full?: boolean;
}) {
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

  if (full) {
    return (
      <button
        type="button"
        disabled={state === "proses"}
        onClick={() => void unduh()}
        className="block w-full border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-60"
      >
        {state === "proses"
          ? "⏳ Mengunduh…"
          : state === "gagal"
            ? "⚠ Gagal — coba lagi"
            : "⬇ Unduh"}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={state === "proses"}
      onClick={() => void unduh()}
      className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 disabled:opacity-60"
    >
      {state === "proses" ? "⏳ Mengunduh…" : state === "gagal" ? "⚠ Gagal" : "⬇ Unduh"}
    </button>
  );
}

/** Tombol salin teks keterangan laporan (clipboard API + fallback lama). */
function CopyTeksButton({ teks }: { teks: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    setFailed(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(teks);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = teks;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        if (!ok) throw new Error("copy gagal");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
      window.setTimeout(() => setFailed(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={
        "rounded-lg border px-3 py-1.5 text-xs font-semibold transition " +
        (copied
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : failed
            ? "border-red-200 bg-red-50 text-red-600"
            : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100")
      }
    >
      {copied ? "Tersalin ✓" : failed ? "Gagal salin" : "📋 Salin keterangan"}
    </button>
  );
}
export default function LaporanGiatScreen({ refreshKey, rekapMode, session }: Props) {
  const [preset, setPreset] = useState<Preset>("harian");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [reguId, setReguId] = useState("all");
  const [kategori, setKategori] = useState<"all" | "kegiatan" | "kejadian">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortDir>("terbaru");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<Laporan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: reguSemua = [] } = useQuery({
    queryKey: ["regu-list"],
    queryFn: fetchReguList,
  });
  // Lapisan klien di atas RLS (migration 0026): dropdown & export hanya
  // menawarkan unit dalam cakupan pemantau.
  const reguList = useMemo(
    () => reguSemua.filter((r) => reguDalamCakupan(session, r)),
    [reguSemua, session],
  );
  const range = useMemo(() => presetRange(preset, custom), [preset, custom]);

  const { data: laporan = [], isFetching } = useQuery({
    queryKey: ["laporan-giat", preset, custom, reguId, kategori, refreshKey],
    queryFn: () =>
      fetchLaporan({
        from: range.from,
        to: range.to,
        reguId: reguId === "all" ? undefined : reguId,
        kategori: kategori === "all" ? undefined : kategori,
        limit: 2000,
        session,
      }),
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("id-ID");
    let rows = laporan;
    if (query) {
      const terms = query.split(/\s+/).filter(Boolean);
      rows = rows.filter((l) => {
        const searchable = [
          l.regu ? reguDisplayName(l.regu) : l.regu_id,
          l.regu?.unit_key ?? "",
          l.regu?.wilayah_key ?? "",
          l.perihal,
          l.catatan,
          l.nrp_pelapor ?? "",
          l.jenis?.nama ?? "",
          l.kategori,
          l.tahap,
          formatWaktu(l.timestamp_kirim),
          l.timestamp_kirim,
        ]
          .filter((v) => v != null && v !== "")
          .join(" ")
          .toLocaleLowerCase("id-ID");
        return terms.every((t) => searchable.includes(t));
      });
    }
    if (sort === "terlama") rows = [...rows].reverse();
    return rows;
  }, [laporan, search, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const shown = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const handleExport = async (kind: "pdf" | "excel") => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "pdf") {
        await exportPdf(filtered, { range, reguList, reguId });
      } else {
        await exportExcel(filtered, { range, reguList, reguId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat laporan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="flex items-start gap-3">
        <span className="mt-0.5 text-3xl">📄</span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            {rekapMode ? "Rekap & Unduh" : "Laporan Giat"}
          </h1>
          <p className="text-sm text-slate-500">
            Daftar seluruh laporan kegiatan & kejadian di lingkungan Polres
            Purwakarta.
          </p>
        </div>
      </section>

      {/* Filter panel */}
      <section className="card space-y-4">
        <input
          type="search"
          className="input"
          placeholder="Cari kegiatan, lokasi, pelapor, dll…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-500">
            Periode Tanggal
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["harian", "Harian"],
                ["mingguan", "Mingguan"],
                ["bulanan", "Bulanan"],
                ["custom", "Custom"],
              ] as Array<[Preset, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPreset(key)}
                className={
                  "rounded-lg px-3 py-2 text-sm font-semibold transition " +
                  (preset === key
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                }
              >
                {label}
              </button>
            ))}
            {preset === "custom" && (
              <span className="flex items-center gap-2">
                <input
                  type="date"
                  className="input w-auto"
                  value={custom.from}
                  onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                />
                <span className="text-slate-400">—</span>
                <input
                  type="date"
                  className="input w-auto"
                  value={custom.to}
                  onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                />
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-500">
            Pelapor / Unit
            <select
              className="input mt-1"
              value={reguId}
              onChange={(e) => {
                setReguId(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">Semua Unit</option>
              {reguList.map((r) => (
                <option key={r.id} value={r.id}>
                  {reguDisplayName(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Kategori Kegiatan
            <select
              className="input mt-1"
              value={kategori}
              onChange={(e) => {
                setKategori(e.target.value as typeof kategori);
                setPage(0);
              }}
            >
              <option value="all">Semua Kategori</option>
              <option value="kegiatan">📋 Kegiatan</option>
              <option value="kejadian">⚡ Kejadian</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Urutan
            <select
              className="input mt-1"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortDir)}
            >
              <option value="terbaru">Terbaru</option>
              <option value="terlama">Terlama</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">
            Menampilkan {filtered.length === 0 ? 0 : safePage * pageSize + 1}–
            {Math.min((safePage + 1) * pageSize, filtered.length)} dari{" "}
            <b>{filtered.length}</b> laporan
            {isFetching && " · memuat…"}
          </span>
          <div className="flex flex-wrap gap-2">
            <select
              className="input w-auto py-2 text-xs"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n} / halaman
                </option>
              ))}
            </select>
            <button
              className="btn-secondary"
              disabled={busy || isFetching}
              onClick={() => void handleExport("excel")}
            >
              📊 Excel
            </button>
            <button
              className="btn-primary"
              disabled={busy || isFetching}
              onClick={() => void handleExport("pdf")}
            >
              {busy ? "⏳ Memproses…" : "📄 Unduh PDF"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Ringkasan kartu untuk layar kecil agar isi laporan tidak menyempit. */}
      <section className="space-y-3 lg:hidden">
        {shown.map((l, i) => (
          <article key={l.id} className="card space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-500">
                  #{safePage * pageSize + i + 1} ·{" "}
                  {new Date(l.timestamp_kirim).toLocaleDateString("id-ID", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
                <div className="mt-1 text-sm font-bold leading-snug text-slate-800">
                  {l.regu ? reguDisplayName(l.regu).split(" — ")[0] : l.regu_id}
                </div>
                <div className="text-xs text-slate-500">
                  {new Date(l.timestamp_kirim).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  WIB
                  {l.nrp_pelapor ? ` · NRP ${l.nrp_pelapor}` : ""}
                </div>
              </div>
              <span
                className={
                  "badge shrink-0 " +
                  (KATEGORI_BADGE[l.kategori] ?? "bg-slate-100 text-slate-600")
                }
              >
                {l.kategori === "kejadian" ? "⚡ Kejadian" : "📋 Kegiatan"}
              </span>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Perihal / Kegiatan
              </div>
              <div className="mt-1 text-sm leading-5 text-slate-700">
                {l.perihal ?? l.catatan ?? "—"}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
              <span className="min-w-0 truncate">
                <span className="font-semibold text-slate-600">Lokasi: </span>
                <PlaceBadge lat={l.latitude} lng={l.longitude} />
              </span>
              <button
                onClick={() => setPreview(l)}
                className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                👁 Lihat
              </button>
            </div>
          </article>
        ))}
        {shown.length === 0 && (
          <div className="card px-4 py-10 text-center text-sm text-slate-400">
            Tidak ada laporan pada filter ini.
          </div>
        )}
      </section>
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500 lg:hidden">
        <span>
          Halaman {safePage + 1} dari {pages}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            aria-label="Halaman sebelumnya"
          >
            ‹
          </button>
          <span className="px-2 font-semibold text-slate-600">
            {safePage + 1}
          </span>
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
            aria-label="Halaman berikutnya"
          >
            ›
          </button>
        </div>
      </div>

      {/* Tabel desktop */}
      <section className="card hidden overflow-x-auto p-0 lg:block">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">No</th>
              <th className="px-4 py-3">Tanggal & Waktu</th>
              <th className="px-4 py-3">Pelapor / Unit</th>
              <th className="px-4 py-3">Perihal / Kegiatan</th>
              <th className="px-4 py-3">Jenis</th>
              <th className="px-4 py-3">Lokasi</th>
              <th className="px-4 py-3">Dokumentasi</th>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((l, i) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-xs text-slate-400">
                  {safePage * pageSize + i + 1}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="font-semibold text-slate-800">
                    {new Date(l.timestamp_kirim).toLocaleDateString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(l.timestamp_kirim).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    WIB
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">
                    {l.regu ? reguDisplayName(l.regu).split(" — ")[0] : l.regu_id}
                  </div>
                  <div className="text-xs text-slate-500">
                    {l.nrp_pelapor ? `NRP ${l.nrp_pelapor} · ` : ""}
                    {l.regu?.wilayah_key
                      ? `Polsek ${l.regu.wilayah_key}`
                      : (l.regu?.unit_key ?? "")}
                  </div>
                </td>
                <td className="max-w-[260px] px-4 py-3">
                  <div className="line-clamp-2 text-slate-700">
                    {l.perihal ?? l.catatan ?? "—"}
                  </div>
                  {l.tahap && l.tahap !== "awal" && (
                    <span className="badge mt-1 bg-slate-100 text-slate-600">
                      {TAHAP_LABEL[l.tahap]}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "badge " +
                      (KATEGORI_BADGE[l.kategori] ?? "bg-slate-100 text-slate-600")
                    }
                  >
                    {l.kategori === "kejadian" ? "⚡ Kejadian" : "📋 Kegiatan"}
                  </span>
                  {l.jenis && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {l.jenis.nama}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  <PlaceBadge lat={l.latitude} lng={l.longitude} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {(l.fotos ?? []).slice(0, 2).map((f) => (
                      <img
                        key={f.id}
                        src={fotoUrl(f.storage_path)}
                        alt="foto"
                        loading="lazy"
                        className="h-8 w-8 rounded-md border border-slate-200 object-cover"
                      />
                    ))}
                    {(l.fotos?.length ?? 0) > 2 && (
                      <span className="text-xs text-slate-500">
                        +{(l.fotos?.length ?? 0) - 2}
                      </span>
                    )}
                    {(l.videos?.length ?? 0) > 0 && (
                      <span className="text-xs text-sky-600">
                        🎥{l.videos!.length}
                      </span>
                    )}
                    {(l.fotos?.length ?? 0) === 0 &&
                      (l.videos?.length ?? 0) === 0 && (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setPreview(l)}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    👁 Preview
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  Tidak ada laporan pada filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Paginasi */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            Halaman {safePage + 1} dari {pages}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              ‹
            </button>
            {Array.from({ length: Math.min(5, pages) }, (_, idx) => {
              const start = Math.max(0, Math.min(safePage - 2, pages - 5));
              return start + idx;
            })
              .filter((p) => p >= 0 && p < pages)
              .map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={
                    "rounded-lg px-3 py-1.5 font-semibold " +
                    (p === safePage
                      ? "bg-blue-600 text-white"
                      : "border border-slate-200 hover:bg-slate-50")
                  }
                >
                  {p + 1}
                </button>
              ))}
            <button
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
              disabled={safePage >= pages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              ›
            </button>
          </div>
        </div>
      </section>

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
              <div className="text-xs text-slate-500">
                {new Date(preview.timestamp_kirim).toLocaleString("id-ID")}
              </div>
                <h3 className="mt-0.5 text-lg font-extrabold text-slate-900">
                  {preview.perihal ?? "Laporan"}
                </h3>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span
                    className={
                      "badge " +
                      (KATEGORI_BADGE[preview.kategori] ?? "bg-slate-100")
                    }
                  >
                    {preview.kategori === "kejadian" ? "⚡ Kejadian" : "📋 Kegiatan"}
                  </span>
                  {preview.jenis && (
                    <span className="badge bg-slate-100 text-slate-600">
                      {preview.jenis.nama}
                    </span>
                  )}
                  {preview.tahap && (
                    <span className="badge bg-slate-100 text-slate-600">
                      {TAHAP_LABEL[preview.tahap] ?? preview.tahap}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-500"
              >
                ✕
              </button>
            </div>

            <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {preview.catatan ?? "—"}
            </p>
            {preview.catatan && (
              <div className="mt-2 flex justify-end">
                <CopyTeksButton teks={preview.catatan} />
              </div>
            )}

            <div className="mt-3 text-xs text-slate-500">
              Pelapor:{" "}
              <b className="text-slate-700">
                {preview.regu ? reguDisplayName(preview.regu) : preview.regu_id}
              </b>
              {preview.nrp_pelapor && (
                <span className="ml-2">
                  · NRP <b className="text-slate-700">{preview.nrp_pelapor}</b>
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              <PlaceBadge lat={preview.latitude} lng={preview.longitude} />
            </div>

            {(preview.fotos?.length ?? 0) > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {preview.fotos!.map((f) => (
                  <div
                    key={f.id}
                    className="overflow-hidden rounded-xl border border-slate-200"
                  >
                    <a
                      href={fotoUrl(f.storage_path)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={fotoUrl(f.storage_path)}
                        alt="foto laporan"
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                    <UnduhMediaButton storagePath={f.storage_path} full />
                  </div>
                ))}
              </div>
            )}
            {(preview.videos?.length ?? 0) > 0 && (
              <div className="mt-3 space-y-2">
                {preview.videos!.map((v) => (
                  <div
                    key={v.id}
                    className="overflow-hidden rounded-xl border border-slate-200"
                  >
                    <video
                      src={fotoUrl(v.storage_path)}
                      controls
                      className="w-full"
                    />
                    <UnduhMediaButton storagePath={v.storage_path} full />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatWaktu(iso: string): string {
  return new Date(iso).toLocaleString("id-ID");
}
