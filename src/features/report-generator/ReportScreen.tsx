import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Laporan } from "../../types";
import { fetchLaporan, fetchReguList } from "../../lib/supabase/api";
import { formatKoordinat, formatWaktu } from "../../lib/cycle";
import { exportPdf } from "./exportPdf";
import { exportExcel } from "./exportExcel";
import { reguDisplayName } from "../../lib/regu";

type Preset = "harian" | "mingguan" | "bulanan" | "custom";

function presetRange(
  preset: Preset,
  custom?: { from: string; to: string },
): { from: Date; to: Date } {
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

/** Generator laporan: filter rentang + kategori, export PDF/Excel. */
export default function ReportScreen() {
  const [preset, setPreset] = useState<Preset>("harian");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [reguId, setReguId] = useState<string>("all"); // 'all' = gabungan
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: reguList = [] } = useQuery({
    queryKey: ["regu-list"],
    queryFn: fetchReguList,
  });
  const range = useMemo(() => presetRange(preset, custom), [preset, custom]);

  const { data: laporan = [], isFetching } = useQuery({
    queryKey: ["laporan-report", preset, custom, reguId],
    queryFn: () =>
      fetchLaporan({
        from: range.from,
        to: range.to,
        reguId: reguId === "all" ? undefined : reguId,
        limit: 2000,
      }),
  });

  const filteredLaporan = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("id-ID");
    if (!query) return laporan;

    return laporan.filter((l) => {
      const searchable = [
        l.regu ? reguDisplayName(l.regu) : l.regu_id,
        l.catatan,
        l.siklus_ke,
        l.latitude,
        l.longitude,
        l.status_sync,
        formatWaktu(l.timestamp_kirim),
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLocaleLowerCase("id-ID");
      return searchable.includes(query);
    });
  }, [laporan, search]);

  const totalFoto = filteredLaporan.reduce(
    (a, l) => a + (l.fotos?.length ?? 0),
    0,
  );

  const handleExport = async (kind: "pdf" | "excel") => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "pdf") {
        await exportPdf(filteredLaporan, { range, reguList, reguId });
      } else {
        await exportExcel(filteredLaporan, { range, reguList, reguId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat laporan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card space-y-4">
        <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-200">
          Asal pelapor ditampilkan pada setiap nama. Data yang belum memiliki
          mapping Polsek akan diberi tanda “Polsek belum ditentukan”.
        </div>
        {/* Preset rentang waktu */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-300">
            Rentang waktu
          </label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["harian", "Harian"],
                ["mingguan", "7 Hari"],
                ["bulanan", "30 Hari"],
                ["custom", "Custom"],
              ] as Array<[Preset, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPreset(key)}
                className={
                  "rounded-lg px-3.5 py-2 text-sm font-semibold transition " +
                  (preset === key
                    ? "bg-gold-400 text-navy-900"
                    : "bg-navy-900 text-slate-300 hover:text-white")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Dari</label>
              <input
                type="date"
                className="input"
                value={custom.from}
                onChange={(e) =>
                  setCustom((c) => ({ ...c, from: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Sampai
              </label>
              <input
                type="date"
                className="input"
                value={custom.to}
                onChange={(e) =>
                  setCustom((c) => ({ ...c, to: e.target.value }))
                }
              />
            </div>
          </div>
        )}

        {/* Kategori laporan */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-300">
            Kategori
          </label>
          <select
            className="input"
            value={reguId}
            onChange={(e) => setReguId(e.target.value)}
          >
            <option value="all">Laporan Gabungan (semua pelapor)</option>
            {reguList.map((r) => (
              <option key={r.id} value={r.id}>
                {reguDisplayName(r)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="report-search"
            className="mb-2 block text-sm font-medium text-slate-300"
          >
            Cari laporan
          </label>
          <div className="flex gap-2">
            <input
              id="report-search"
              type="search"
              className="input"
              placeholder="Cari pelapor, keterangan, siklus, waktu, koordinat, atau status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="rounded-lg bg-navy-900 px-3 text-sm text-slate-300 hover:text-white"
                onClick={() => setSearch("")}
                aria-label="Hapus pencarian"
              >
                Hapus
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Ringkasan hasil */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="text-xs text-slate-400">Total laporan</div>
          <div className="text-xl font-bold">{filteredLaporan.length}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-400">Total foto</div>
          <div className="text-xl font-bold">{totalFoto}</div>
        </div>
        <div className="card col-span-2 sm:col-span-1">
          <div className="text-xs text-slate-400">Rentang</div>
          <div className="text-sm font-semibold">
            {range.from.toLocaleDateString("id-ID")} —{" "}
            {range.to.toLocaleDateString("id-ID")}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          className="btn-primary flex-1"
          disabled={busy || isFetching}
          onClick={() => void handleExport("pdf")}
        >
          {busy ? "⏳ Memproses…" : "📄 Export PDF"}
        </button>
        <button
          className="btn-secondary flex-1"
          disabled={busy || isFetching}
          onClick={() => void handleExport("excel")}
        >
          📊 Export Excel
        </button>
      </div>
      {search.trim() && (
        <p className="text-sm text-slate-400">
          Menampilkan {filteredLaporan.length} dari {laporan.length} laporan
          sesuai pencarian. Hasil export mengikuti pencarian ini.
        </p>
      )}

      {/* Pratinjau tabel (dipaginasi sederhana) */}
      <PreviewTable laporan={filteredLaporan} hasSearch={Boolean(search.trim())} />
    </div>
  );
}

function PreviewTable({
  laporan,
  hasSearch,
}: {
  laporan: Laporan[];
  hasSearch: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(laporan.length / pageSize));
  const shown = laporan.slice(page * pageSize, (page + 1) * pageSize);

  if (laporan.length === 0) {
    return (
      <div className="card text-sm text-slate-400">
        {hasSearch
          ? "Tidak ada laporan yang cocok dengan pencarian."
          : "Tidak ada laporan pada rentang & kategori ini."}
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-navy-700 text-xs uppercase text-slate-400">
          <tr>
            <th className="px-4 py-3">Waktu</th>
            <th className="px-4 py-3">Pelapor</th>
            <th className="px-4 py-3">Siklus</th>
            <th className="px-4 py-3">Koordinat</th>
            <th className="px-4 py-3">Foto</th>
            <th className="px-4 py-3">Video</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => (
            <tr
              key={l.id}
              className="border-b border-navy-800/60 hover:bg-navy-800/40"
            >
              <td className="px-4 py-2.5 whitespace-nowrap">
                {formatWaktu(l.timestamp_kirim)}
              </td>
              <td className="px-4 py-2.5">
                {l.regu
                  ? reguDisplayName(l.regu)
                  : l.regu_id}
              </td>
              <td className="px-4 py-2.5">{l.siklus_ke}</td>
              <td className="px-4 py-2.5 text-xs">
                {formatKoordinat(l.latitude, l.longitude)}
              </td>
              <td className="px-4 py-2.5">{l.fotos?.length ?? 0}</td>
              <td className="px-4 py-2.5">{l.videos?.length ?? 0}</td>
              <td className="px-4 py-2.5">
                <span
                  className={
                    "badge " +
                    (l.status_sync === "synced"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300")
                  }
                >
                  {l.status_sync}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-400">
        <span>
          Halaman {page + 1} dari {pages}
        </span>
        <div className="flex gap-2">
          <button
            className="btn-secondary px-3 py-1.5 text-xs"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Sebelumnya
          </button>
          <button
            className="btn-secondary px-3 py-1.5 text-xs"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Berikutnya →
          </button>
        </div>
      </div>
    </div>
  );
}
