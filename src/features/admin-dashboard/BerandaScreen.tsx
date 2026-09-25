import { useEffect, useMemo, useState } from "react";
import { fetchDashboardSummary } from "../../lib/supabase/api";
import { reguDisplayName } from "../../lib/regu";
import { fotoUrl } from "../../lib/supabase/api";
import type { SessionUser } from "../../types";

interface Props {
  refreshKey: number;
  onOpenTab: (tab: "laporan" | "statistik" | "peta" | "rekap" | "manajemen") => void;
  session?: SessionUser | null;
}

type Preset = "harian" | "7" | "30";

function rangeFor(preset: Preset): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date();
  if (preset === "harian") from.setHours(0, 0, 0, 0);
  else if (preset === "7") from.setDate(from.getDate() - 6), from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - 29), from.setHours(0, 0, 0, 0);
  return { from, to };
}

/** Bar chart vertikal (kolom) untuk Monitoring Wilayah & Fungsi. */
function VBar({
  label,
  value,
  max,
  color,
  index,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  index: number;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="wilayah-bar flex min-w-[4.25rem] flex-1 flex-col items-center gap-2">
      <span className={"wilayah-value wilayah-value-" + index}>{value}</span>
      <div className="wilayah-bar-track flex h-32 w-full items-end justify-center">
        <div
          className={"wilayah-bar-fill w-9 rounded-t-xl transition-all " + color}
          style={{ height: `${Math.max(pct, 5)}%`, animationDelay: `${index * 70}ms` }}
          title={`${label}: ${value} laporan`}
        >
          <span className="wilayah-bar-shine" />
        </div>
      </div>
      <span
        className="w-full truncate text-center text-[11px] font-semibold text-slate-600"
        title={label}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Beranda / Dashboard Pemantau — kartu ringkasan + Monitoring Wilayah
 * & Fungsi (bar chart) + daftar Laporan Terbaru, sesuai mockup.
 */
export default function BerandaScreen({ refreshKey, onOpenTab, session }: Props) {
  const [preset, setPreset] = useState<Preset>("harian");
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchDashboardSummary>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => rangeFor(preset), [preset]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const summary = await fetchDashboardSummary(range.from, range.to, session);
        if (!active) return;
        setData(summary);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [range, refreshKey, session]);

  const maxWilayah = Math.max(1, ...(data?.perWilayah.map((w) => w.jumlah) ?? [1]));
  const maxUnit = Math.max(1, ...(data?.perUnit.map((w) => w.jumlah) ?? [1]));
  const terbaru = (data?.rows ?? []).slice(0, 8);
  const wilayahColors = [
    "wilayah-gradient-blue",
    "wilayah-gradient-violet",
    "wilayah-gradient-emerald",
    "wilayah-gradient-orange",
    "wilayah-gradient-pink",
    "wilayah-gradient-cyan",
    "wilayah-gradient-indigo",
  ];

  return (
    <div className="space-y-5">
      {/* Header + preset */}
      <section className="dash-page-heading flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Pusat kendali pelaporan</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[1.7rem]">
            Dashboard Pemantau
          </h1>
          <p className="text-sm text-slate-500">
            Memantau seluruh laporan giat berdasarkan wilayah dan fungsi.
          </p>
        </div>
        <div className="flex gap-2">
          {(
            [
              ["harian", "Hari Ini"],
              ["7", "7 Hari"],
              ["30", "30 Hari"],
            ] as Array<[Preset, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={
                "rounded-xl px-4 py-2 text-sm font-semibold transition " +
                (preset === key
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Kartu ringkasan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard
          icon="📄"
          tint="bg-red-50 text-red-600"
          label="Total Laporan"
          value={data?.total}
        />
        <SummaryCard
          icon="📋"
          tint="bg-sky-50 text-sky-600"
          label="Kegiatan"
          value={data?.kegiatan}
        />
        <SummaryCard
          icon="⚡"
          tint="bg-amber-50 text-amber-600"
          label="Kejadian"
          value={data?.kejadian}
        />
        <SummaryCard
          icon="📷"
          tint="bg-emerald-50 text-emerald-600"
          label="Foto & Video"
          value={
            data != null
              ? `${data.foto + data.video}`
              : undefined
          }
        />
        <SummaryCard
          icon="🛡️"
          tint="bg-blue-50 text-blue-600"
          label="Pelapor Aktif"
          value={data?.pelaporAktif}
        />
      </div>

      {/* Monitoring wilayah & fungsi */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">📊 Monitoring Wilayah</h2>
            <button
              onClick={() => onOpenTab("statistik")}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              Lihat Semua →
            </button>
          </div>
          <div className="flex items-end gap-2 overflow-x-auto pb-1">
            {(data?.perWilayah ?? []).map((w, index) => (
              <VBar
                key={w.key}
                label={w.label}
                value={w.jumlah}
                max={maxWilayah}
                color={wilayahColors[index % wilayahColors.length]}
                index={index}
              />
            ))}
            {(data?.perWilayah.length ?? 0) === 0 && (
              <p className="w-full py-6 text-center text-sm text-slate-400">
                Belum ada data pada periode ini.
              </p>
            )}
          </div>
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">📈 Monitoring Fungsi</h2>
            <button
              onClick={() => onOpenTab("statistik")}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              Lihat Semua →
            </button>
          </div>
          <div className="flex items-end gap-2 overflow-x-auto pb-1">
            {(data?.perUnit ?? []).map((w, index) => (
              <VBar
                key={w.key}
                label={w.label}
                value={w.jumlah}
                max={maxUnit}
                color={wilayahColors[(index + 2) % wilayahColors.length]}
                index={index}
              />
            ))}
            {(data?.perUnit.length ?? 0) === 0 && (
              <p className="w-full py-6 text-center text-sm text-slate-400">
                Belum ada data pada periode ini.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Laporan terbaru */}
      <section className="card p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-bold text-slate-800">📝 Laporan Terbaru</h2>
          <button
            onClick={() => onOpenTab("laporan")}
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            Lihat Semua →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Waktu</th>
                <th className="px-4 py-2.5">Pelapor</th>
                <th className="px-4 py-2.5">Jenis</th>
                <th className="px-4 py-2.5">Perihal</th>
                <th className="px-4 py-2.5">Konten</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {terbaru.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                    {new Date(l.timestamp_kirim).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-700">
                    {l.regu ? reguDisplayName(l.regu).split(" — ")[0] : l.regu_id}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        "badge " +
                        (l.kategori === "kejadian"
                          ? "bg-red-50 text-red-700"
                          : "bg-sky-50 text-sky-700")
                      }
                    >
                      {l.kategori === "kejadian" ? "⚡ Kejadian" : "📋 Kegiatan"}
                    </span>
                  </td>
                  <td className="max-w-[240px] px-4 py-2.5">
                    <span className="line-clamp-1 text-slate-600">
                      {l.perihal ?? l.catatan ?? "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                    {l.fotos?.length ?? 0} foto
                    {(l.videos?.length ?? 0) > 0
                      ? `, ${l.videos!.length} video`
                      : ""}
                    {(l.fotos?.length ?? 0) > 0 && (
                      <img
                        src={fotoUrl(l.fotos![0].storage_path)}
                        alt=""
                        loading="lazy"
                        className="ml-2 inline h-6 w-6 rounded border border-slate-200 object-cover align-middle"
                      />
                    )}
                  </td>
                </tr>
              ))}
              {terbaru.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Belum ada laporan pada periode ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: string;
  label: string;
  value?: number | string;
  tint: string;
}) {
  return (
    <div className="card summary-card">
      <div className="flex items-center gap-2.5">
        <span
          className={"flex h-10 w-10 items-center justify-center rounded-xl text-lg " + tint}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-slate-500">
            {label}
          </div>
          <div className="text-xl font-extrabold tracking-tight text-slate-900">
            {value ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
