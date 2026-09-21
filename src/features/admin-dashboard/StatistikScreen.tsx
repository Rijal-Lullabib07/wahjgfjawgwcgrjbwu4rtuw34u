import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { fetchDashboardSummary } from "../../lib/supabase/api";

interface Props {
  refreshKey: number;
}

type Preset = "harian" | "7" | "30" | "custom";

function rangeFor(preset: Preset, custom: { from: string; to: string }) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date();
  if (preset === "harian") from.setHours(0, 0, 0, 0);
  else if (preset === "7") {
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
  } else if (preset === "30") {
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
  } else {
    if (custom.from) from.setTime(new Date(custom.from + "T00:00:00").getTime());
    if (custom.to) to.setTime(new Date(custom.to + "T23:59:59").getTime());
  }
  return { from, to };
}

function VStatBar({
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
    <div className="stat-vbar">
      <span className="stat-vbar-value">{value}</span>
      <div className="stat-vbar-track">
        <div
          className={"stat-vbar-fill " + color}
          style={{ height: `${Math.max(pct, 5)}%`, animationDelay: `${index * 80}ms` }}
          title={`${label}: ${value} laporan`}
        />
      </div>
      <span className="stat-vbar-label" title={label}>
        {label}
      </span>
    </div>
  );
}

const STAT_WARNA = [
  "stat-gradient-blue",
  "stat-gradient-violet",
  "stat-gradient-emerald",
  "stat-gradient-orange",
  "stat-gradient-pink",
  "stat-gradient-cyan",
  "stat-gradient-indigo",
];

/**
 * Statistik — ringkasan periode, distribusi per wilayah & fungsi,
 * tren harian (sparkline div), dan komposisi Kegiatan vs Kejadian
 * + jenis laporan teratas.
 */
export default function StatistikScreen({ refreshKey }: Props) {
  const [preset, setPreset] = useState<Preset>("7");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchDashboardSummary>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => rangeFor(preset, custom), [preset, custom]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const summary = await fetchDashboardSummary(range.from, range.to);
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
  }, [range, refreshKey]);

  /** Tren harian: jumlah laporan per tanggal dalam rentang. */
  const tren = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of data?.rows ?? []) {
      const d = new Date(l.timestamp_kirim).toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
      });
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return [...map.entries()].reverse().slice(-14);
  }, [data]);
  const maxTren = Math.max(1, ...tren.map(([, v]) => v));

  const maxWilayah = Math.max(1, ...(data?.perWilayah.map((w) => w.jumlah) ?? [1]));
  const maxUnit = Math.max(1, ...(data?.perUnit.map((w) => w.jumlah) ?? [1]));

  /** Jenis teratas dari seluruh baris. */
  const jenisTop = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of data?.rows ?? []) {
      const key = l.jenis?.nama ?? "Tanpa jenis";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [data]);
  const maxJenis = Math.max(1, ...jenisTop.map(([, v]) => v));

  const total = data?.total ?? 0;
  const pctKegiatan = total > 0 ? Math.round(((data?.kegiatan ?? 0) / total) * 100) : 0;
  const pctKejadian = total > 0 ? 100 - pctKegiatan : 0;
  const hariCount = tren.length || 1;

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            📊 Statistik
          </h1>
          <p className="text-sm text-slate-500">
            Ringkasan statistik laporan kegiatan & kejadian.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["harian", "Harian"],
              ["7", "7 Hari"],
              ["30", "30 Hari"],
              ["custom", "Custom"],
            ] as Array<[Preset, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={
                "rounded-xl px-3.5 py-2 text-sm font-semibold transition " +
                (preset === key
                  ? "bg-blue-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {preset === "custom" && (
        <div className="card flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-500">
            Dari
            <input
              type="date"
              className="input mt-1"
              value={custom.from}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Sampai
            <input
              type="date"
              className="input mt-1"
              value={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            />
          </label>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Kartu ringkasan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Laporan" value={data?.total} />
        <StatCard label="Kegiatan" value={data?.kegiatan} accent="text-sky-600" />
        <StatCard label="Kejadian" value={data?.kejadian} accent="text-red-600" />
        <StatCard
          label="Foto & Video"
          value={data != null ? data.foto + data.video : undefined}
          accent="text-emerald-600"
        />
        <StatCard
          label="Rata-rata per Hari"
          value={data ? Math.round((data.total / hariCount) * 10) / 10 : undefined}
          accent="text-violet-600"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per wilayah */}
        <section className="card">
          <h2 className="mb-3 font-bold text-slate-800">Statistik per Wilayah</h2>
          <div className="space-y-2.5">
            <div className="stat-vbar-chart">
            {(data?.perWilayah ?? []).map((w, i) => (
              <VStatBar
                key={w.key}
                label={w.label}
                value={w.jumlah}
                max={maxWilayah}
                color={STAT_WARNA[i % STAT_WARNA.length]}
                index={i}
              />
            ))}
            </div>
            {(data?.perWilayah.length ?? 0) === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">
                Belum ada data.
              </p>
            )}
          </div>
        </section>

        {/* Per fungsi */}
        <section className="card">
          <h2 className="mb-3 font-bold text-slate-800">Statistik per Fungsi</h2>
          <div className="space-y-2.5">
            <div className="stat-vbar-chart">
            {(data?.perUnit ?? []).map((w, i) => (
              <VStatBar
                key={w.key}
                label={w.label}
                value={w.jumlah}
                max={maxUnit}
                color={STAT_WARNA[(i + 2) % STAT_WARNA.length]}
                index={i}
              />
            ))}
            </div>
            {(data?.perUnit.length ?? 0) === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">
                Belum ada data.
              </p>
            )}
          </div>
        </section>

        {/* Tren */}
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800">Tren Laporan Harian</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Aktivitas laporan dalam periode terpilih</p>
            </div>
            <span className="trend-live-badge">LIVE</span>
          </div>
          <div className="trend-chart">
            <div className="trend-grid-line trend-grid-line-top" />
            <div className="trend-grid-line trend-grid-line-mid" />
            <div className="trend-grid-line trend-grid-line-bottom" />
            {tren.map(([label, v], index) => (
              <div key={label} className="trend-column">
                <span className="trend-value">{v}</span>
                <div className="trend-bar-track">
                  <div
                    className="trend-bar"
                    style={{
                      height: `${Math.max((v / maxTren) * 100, 4)}%`,
                      animationDelay: `${index * 70}ms`,
                    }}
                    title={`${label}: ${v} laporan`}
                  >
                    <span className="trend-bar-glow" />
                  </div>
                </div>
                <span className="trend-label">
                  {label}
                </span>
              </div>
            ))}
            {tren.length === 0 && (
              <p className="w-full py-10 text-center text-sm text-slate-400">
                Belum ada data.
              </p>
            )}
          </div>
        </section>

        {/* Komposisi kategori + jenis teratas */}
        <section className="card">
          <h2 className="mb-3 font-bold text-slate-800">
            Komposisi Kategori & Jenis
          </h2>
          <div
            className="category-composition mb-4"
            style={
              {
                "--kegiatan": `${pctKegiatan}%`,
                "--kejadian": `${pctKejadian}%`,
              } as CSSProperties
            }
          >
            <div className="category-composition-glow" />
            <div className="category-composition-fill" />
          </div>
          <div className="mb-4 flex gap-4 text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-sky-600">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              📋 Kegiatan {pctKegiatan}%
            </span>
            <span className="flex items-center gap-1.5 text-red-600">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              ⚡ Kejadian {pctKejadian}%
            </span>
          </div>
          <div className="stat-vbar-chart stat-vbar-chart-compact">
            {jenisTop.map(([label, v], i) => (
              <VStatBar
                key={label}
                label={label}
                value={v}
                max={maxJenis}
                color={STAT_WARNA[(i + 1) % STAT_WARNA.length]}
                index={i}
              />
            ))}
          </div>
          <div>
            {jenisTop.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">
                Belum ada data.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value?: number;
  accent?: string;
}) {
  return (
    <div className="card">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div
        className={
          "mt-1.5 text-2xl font-extrabold tracking-tight " +
          (accent ?? "text-slate-900")
        }
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
