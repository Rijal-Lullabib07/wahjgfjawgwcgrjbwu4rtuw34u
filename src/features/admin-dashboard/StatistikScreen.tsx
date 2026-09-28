import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchDashboardSummary,
  unitLabel,
  wilayahLabel,
} from "../../lib/supabase/api";
import type { RingkasanKelompok } from "../../lib/supabase/api";
import {
  cariPersonelBatch,
  personelFormat,
  type PersonelPolri,
} from "../../lib/personel";
import type { Laporan, SessionUser } from "../../types";

interface Props {
  refreshKey: number;
  session?: SessionUser;
}

type Preset = "harian" | "7" | "30" | "custom";
type Summary = Awaited<ReturnType<typeof fetchDashboardSummary>>;

const PALET = [
  "#3ed8ff",
  "#9b8cff",
  "#45e3a8",
  "#ffb636",
  "#ff6f9c",
  "#5f8bff",
];

const TABS: Array<[Preset, string]> = [
  ["harian", "Harian"],
  ["7", "7 Hari"],
  ["30", "30 Hari"],
  ["custom", "Custom"],
];

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
    if (custom.from)
      from.setTime(new Date(custom.from + "T00:00:00").getTime());
    if (custom.to) to.setTime(new Date(custom.to + "T23:59:59").getTime());
  }
  return { from, to };
}

/** Rentang periode sebelumnya (durasi sama) untuk pembanding ▲/▼. */
function prevRange(from: Date, to: Date) {
  const len = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - len),
    to: new Date(from.getTime() - 1),
  };
}

function deltaPct(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Angka beranimasi count-up (ease-out quart). */
function useCountUp(target: number, duration = 1100): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setVal(target * (1 - Math.pow(1 - k, 4)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length === 0) return null;
  const v = values.length === 1 ? [values[0], values[0]] : values;
  const max = Math.max(1, ...v);
  const pts = v.map(
    (y, i) => [(i / (v.length - 1)) * 100, 36 - (y / max) * 28] as const,
  );
  const d =
    "M" + pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" L");
  return (
    <svg
      className="stx-spark"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        pathLength={100}
        vectorEffect="non-scaling-stroke"
        style={{
          strokeDasharray: 100,
          strokeDashoffset: 100,
          animation: "stx-draw 1.6s 0.3s forwards",
        }}
      />
    </svg>
  );
}

function KpiCard({
  label,
  value,
  color,
  delta,
  invert,
  decimals,
  spark,
}: {
  label: string;
  value: number;
  color: string;
  delta: number | null;
  invert: boolean;
  decimals: number;
  spark: number[];
}) {
  const v = useCountUp(value);
  const shown =
    decimals > 0 ? v.toFixed(1) : Math.round(v).toLocaleString("id-ID");
  // invert: untuk kejadian — naik itu buruk (merah), turun itu baik (hijau).
  const cls =
    delta == null
      ? "stx-delta-muted"
      : delta >= 0
        ? invert
          ? "stx-delta-dn"
          : "stx-delta-up"
        : invert
          ? "stx-delta-up"
          : "stx-delta-dn";
  return (
    <div className="card stx-kpi" style={{ "--c": color } as CSSProperties}>
      <div className="stx-kpi-label">{label}</div>
      <div className="stx-kpi-value">{shown}</div>
      <div className={"stx-kpi-delta " + cls}>
        {delta == null
          ? "— vs periode lalu"
          : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% dari periode lalu`}
      </div>
      <Sparkline values={spark} color={color} />
    </div>
  );
}

function WilayahBars({ items }: { items: RingkasanKelompok[] }) {
  const max = Math.max(1, ...items.map((i) => i.jumlah));
  return (
    <div className="stx-bars">
      {items.map((it, i) => {
        const c = PALET[i % PALET.length];
        return (
          <div className="stx-bar" key={it.key}>
            <span className="stx-bar-num">{it.jumlah}</span>
            <div className="stx-bar-track">
              <div
                className="stx-bar-fill"
                style={
                  {
                    "--h": `${Math.max((it.jumlah / max) * 100, 4)}%`,
                    "--c1": c,
                    "--c2": c + "55",
                    animationDelay: `${i * 90}ms`,
                  } as CSSProperties
                }
                title={`${it.label}: ${it.jumlah} laporan`}
              />
            </div>
            <span className="stx-bar-label" title={it.label}>
              {it.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DonutFungsi({ items }: { items: RingkasanKelompok[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(true), 80);
    return () => window.clearTimeout(t);
  }, []);
  const total = items.reduce((a, b) => a + b.jumlah, 0);
  const shown = useCountUp(total);
  const C = 2 * Math.PI * 46;
  let acc = 0;
  return (
    <div className="stx-donut-wrap">
      <div className="stx-donut-box">
        <svg
          className="stx-donut"
          viewBox="0 0 120 120"
          role="img"
          aria-label="Statistik per fungsi"
        >
          <circle cx="60" cy="60" r="46" stroke="rgba(255,255,255,.06)" />
          {items.map((it, i) => {
            const frac = total > 0 ? it.jumlah / total : 0;
            const len = frac * C;
            const off = acc;
            acc += len;
            return (
              <circle
                key={it.key}
                cx="60"
                cy="60"
                r="46"
                stroke={PALET[i % PALET.length]}
                strokeDasharray={on ? `${Math.max(0, len - 2)} ${C}` : `0 ${C}`}
                strokeDashoffset={-off}
              />
            );
          })}
        </svg>
        <div className="stx-donut-center">
          <div className="stx-donut-total">
            {Math.round(shown).toLocaleString("id-ID")}
          </div>
          <div className="stx-donut-sub">laporan</div>
        </div>
      </div>
      <div className="stx-legend">
        {items.map((it, i) => (
          <div key={it.key}>
            <i style={{ background: PALET[i % PALET.length] }} />
            {it.label}
            <b>{it.jumlah}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendLine({
  points,
}: {
  points: Array<{ label: string; value: number }>;
}) {
  const [tip, setTip] = useState<{
    left: string;
    top: string;
    text: string;
  } | null>(null);
  const W = 700;
  const H = 230;
  const pad = 30;
  const max = Math.max(1, ...points.map((p) => p.value)) + 1;
  const X = (i: number) =>
    pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1);
  const Y = (v: number) => H - 28 - (v / max) * (H - 60);
  const pts = points.map((p, i) => [X(i), Y(p.value)] as const);
  let smooth = "";
  if (pts.length === 1) {
    smooth = `M${pts[0][0]},${pts[0][1]}`;
  } else {
    smooth = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const cx = (a[0] + b[0]) / 2;
      smooth += ` C${cx},${a[1]} ${cx},${b[1]} ${b[0]},${b[1]}`;
    }
  }
  const area =
    pts.length > 1
      ? `${smooth} L${pts[pts.length - 1][0]},${H - 28} L${pts[0][0]},${H - 28} Z`
      : "";
  const step = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div className="stx-trendbox">
      <svg className="stx-trend-svg" viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="stx-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffb636" stopOpacity="0.4" />
            <stop offset="1" stopColor="#ffb636" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => {
          const y = Y((max * i) / 3);
          return (
            <line
              key={i}
              x1={pad}
              x2={W - pad}
              y1={y}
              y2={y}
              stroke="rgba(140,170,255,.12)"
              strokeDasharray="3 5"
            />
          );
        })}
        {area && <path d={area} fill="url(#stx-area)" />}
        <path
          d={smooth}
          fill="none"
          stroke="#ffb636"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          style={{
            strokeDasharray: 100,
            strokeDashoffset: 100,
            animation: "stx-draw 1.8s ease forwards",
            filter: "drop-shadow(0 0 6px rgba(255,182,54,.55))",
          }}
        />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            className="stx-dot"
            cx={x}
            cy={y}
            r="5"
            style={{ "--d": `${i * 40}ms` } as CSSProperties}
            onMouseEnter={() =>
              setTip({
                left: `${(x / W) * 100}%`,
                top: `${(y / H) * 100}%`,
                text: `${points[i].label} · ${points[i].value} laporan`,
              })
            }
            onClick={() =>
              setTip({
                left: `${(x / W) * 100}%`,
                top: `${(y / H) * 100}%`,
                text: `${points[i].label} · ${points[i].value} laporan`,
              })
            }
            onMouseLeave={() => setTip(null)}
          />
        ))}
        {points.map((p, i) =>
          i % step === 0 ? (
            <text
              key={p.label + i}
              className="stx-tick"
              x={X(i)}
              y={H - 8}
              textAnchor="middle"
            >
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      <div
        className={"stx-tip" + (tip ? " stx-tip-on" : "")}
        style={tip ? { left: tip.left, top: tip.top } : undefined}
      >
        {tip?.text ?? ""}
      </div>
    </div>
  );
}

function GaugeKategori({
  kegiatan,
  kejadian,
}: {
  kegiatan: number;
  kejadian: number;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(true), 100);
    return () => window.clearTimeout(t);
  }, []);
  const total = kegiatan + kejadian;
  const pct = total > 0 ? Math.round((kegiatan / total) * 100) : 0;
  const A = Math.PI * 80;
  return (
    <div className="stx-gauge">
      <svg
        viewBox="0 0 200 120"
        role="img"
        aria-label="Rasio kegiatan dan kejadian"
      >
        <path
          className="stx-arc"
          d="M20,100 A80,80 0 0 1 180,100"
          stroke="#ff6f9c"
          opacity={0.85}
        />
        <path
          className="stx-arc"
          d="M20,100 A80,80 0 0 1 180,100"
          stroke="#45e3a8"
          style={{
            strokeDasharray: on ? `${(A * pct) / 100} ${A}` : `0 ${A}`,
            transition: "stroke-dasharray 1.4s cubic-bezier(.2,.9,.2,1)",
          }}
        />
        <text className="stx-gauge-big" x="100" y="92" textAnchor="middle">
          {pct}%
        </text>
        <text className="stx-gauge-sub" x="100" y="110" textAnchor="middle">
          kegiatan
        </text>
      </svg>
      <div className="stx-legend w-full">
        <div>
          <i style={{ background: "#45e3a8" }} />
          Kegiatan
          <b>{kegiatan}</b>
        </div>
        <div>
          <i style={{ background: "#ff6f9c" }} />
          Kejadian
          <b>{kejadian}</b>
        </div>
      </div>
    </div>
  );
}

function RankJenis({ items }: { items: Array<[string, number]> }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(true), 100);
    return () => window.clearTimeout(t);
  }, []);
  const max = Math.max(1, ...items.map(([, v]) => v));
  return (
    <div className="stx-rank">
      {items.map(([label, v], i) => (
        <div className="stx-rk" key={label}>
          <span className="stx-rk-no">{i + 1}</span>
          <span className="stx-rk-name" title={label}>
            {label}
          </span>
          <b>{v}</b>
          <div className="stx-rk-track">
            <i
              className="stx-rk-fill"
              style={{
                width: on ? `${(v / max) * 100}%` : "0%",
                transitionDelay: `${i * 100}ms`,
              }}
            />
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="stx-empty">Belum ada data.</p>}
    </div>
  );
}

const MEDALI = ["🥇", "🥈", "🥉"];

/** Ranking personel teraktif (top 10) — format PANGKAT Nama (Jabatan). */
function RankPersonel({
  items,
}: {
  items: Array<{ label: string; nrp: string; jumlah: number }>;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(true), 100);
    return () => window.clearTimeout(t);
  }, []);
  const max = Math.max(1, ...items.map((it) => it.jumlah));
  return (
    <div className="stx-rank">
      {items.map((it, i) => (
        <div className="stx-rk" key={it.nrp}>
          <span className="stx-rk-no">{MEDALI[i] ?? i + 1}</span>
          <span className="stx-rk-name" title={`${it.label} · NRP ${it.nrp}`}>
            {it.label}
          </span>
          <b>{it.jumlah}</b>
          <div className="stx-rk-track">
            <i
              className="stx-rk-fill"
              style={{
                width: on ? `${(it.jumlah / max) * 100}%` : "0%",
                transitionDelay: `${i * 100}ms`,
              }}
            />
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="stx-empty">Belum ada data.</p>}
    </div>
  );
}

const HARI_SINGKAT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Matriks intensitas laporan per hari-in-minggu × jam (Senin = baris awal). */
function HeatmapJam({ rows }: { rows: Laporan[] }) {
  const matrix = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const l of rows) {
      const d = new Date(l.timestamp_kirim);
      m[(d.getDay() + 6) % 7][d.getHours()] += 1;
    }
    return m;
  }, [rows]);
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="stx-heat">
      <span />
      {Array.from({ length: 24 }, (_, h) => (
        <span key={h} className="stx-heat-hour">
          {h % 6 === 0 ? h : ""}
        </span>
      ))}
      {matrix.map((row, i) => (
        <Fragment key={i}>
          <span className="stx-heat-day">{HARI_SINGKAT[i]}</span>
          {row.map((v, h) => (
            <span
              key={h}
              className="stx-heat-cell"
              title={`${HARI_SINGKAT[i]} ${h}:00 · ${v} laporan`}
              style={{ opacity: v === 0 ? 0.08 : 0.15 + (v / max) * 0.85 }}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

const EMOJI_RULES: Array<[RegExp, string, string]> = [
  [/kebakaran/i, "🔥", "#ff6f9c"],
  [/razia|operasi/i, "🚔", "#ffb636"],
  [/kecelakaan/i, "⚠️", "#ff6f9c"],
  [/pencurian|perampokan|curas|curanmor/i, "🚨", "#ff6f9c"],
  [/massa|unjuk|rally/i, "📣", "#9b8cff"],
  [/patroli/i, "🛡️", "#3ed8ff"],
  [/bakti|silaturahmi|sosial/i, "🤝", "#45e3a8"],
];

function feedEmoji(
  jenisNama: string | null | undefined,
  kategori: string,
): [string, string] {
  const n = jenisNama ?? "";
  for (const [re, emoji, color] of EMOJI_RULES) {
    if (re.test(n)) return [emoji, color];
  }
  return kategori === "kejadian" ? ["⚡", "#ff6f9c"] : ["📋", "#3ed8ff"];
}

function relTime(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
  });
}

function FeedTerbaru({ rows, now }: { rows: Laporan[]; now: number }) {
  const items = rows.slice(0, 6);
  if (items.length === 0) {
    return <p className="stx-empty">Belum ada laporan masuk.</p>;
  }
  return (
    <div className="stx-feed">
      {items.map((l) => {
        const [emoji, color] = feedEmoji(l.jenis?.nama, l.kategori);
        const lok = l.regu?.wilayah_key
          ? `Polsek ${wilayahLabel(l.regu.wilayah_key)}`
          : l.regu?.unit_key
            ? unitLabel(l.regu.unit_key)
            : null;
        return (
          <div className="stx-feed-item" key={l.id}>
            <em className="stx-feed-emoji" style={{ background: color + "33" }}>
              {emoji}
            </em>
            <div className="min-w-0">
              <span className="block truncate">
                {l.perihal ||
                  l.jenis?.nama ||
                  (l.kategori === "kejadian" ? "Kejadian" : "Kegiatan")}
              </span>
              <small className="truncate">
                {l.regu?.nama_regu ?? "Pelapor"}
                {lok ? ` · ${lok}` : ""}
                {` · ${relTime(l.timestamp_kirim, now)}`}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Bucket = { label: string; start: number; end: number };

/**
 * Statistik — kartu KPI beranimasi, distribusi per wilayah (bar) & fungsi
 * (donut), tren harian (line chart), rasio kategori (gauge), peringkat jenis,
 * heatmap jam ramai, dan feed laporan terbaru. Semua dihitung dari rows
 * fetchDashboardSummary — RLS & cakupan pemantau tetap berlaku.
 */
export default function StatistikScreen({ refreshKey, session }: Props) {
  const [preset, setPreset] = useState<Preset>("7");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [data, setData] = useState<Summary | null>(null);
  const [prev, setPrev] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const range = useMemo(() => rangeFor(preset, custom), [preset, custom]);
  // Relevansi kartu mengikuti cakupan: grafik antar-Polsek hanya berarti
  // bagi pemantau lintas Polsek (all), grafik antar-fungsi hanya berarti
  // bagi pemantau lintas fungsi. Kapolsek (wilayah) cukup lihat per-fungsi
  // di Polseknya; Kasat (fungsi) cukup lihat per-wilayah unitnya.
  const level = session?.accessLevel ?? "all";
  const tampilWilayah = level !== "wilayah";
  const tampilFungsi = level !== "fungsi";
  const pRange = useMemo(() => prevRange(range.from, range.to), [range]);
  // Kunci agar animasi grafik diputar ulang tiap ganti periode (bukan tiap refresh).
  const periodKey = `${preset}|${custom.from}|${custom.to}`;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const summary = await fetchDashboardSummary(
          range.from,
          range.to,
          session,
        );
        if (!active) return;
        setData(summary);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
      // Periode sebelumnya hanya untuk indikator ▲/▼ — gagal = sembunyikan.
      try {
        const p = await fetchDashboardSummary(pRange.from, pRange.to, session);
        if (!active) return;
        setPrev(p);
      } catch {
        if (active) setPrev(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [range, pRange, refreshKey]);

  /** Bucket waktu sesuai periode: per jam (harian), per hari, atau per minggu (>62 hari). */
  const bucketDefs = useMemo<Bucket[]>(() => {
    const span = range.to.getTime() - range.from.getTime();
    const days = Math.round(span / 86_400_000);
    if (days <= 1) {
      const day = new Date(range.to);
      day.setHours(0, 0, 0, 0);
      return Array.from({ length: 24 }, (_, h) => {
        const start = new Date(day);
        start.setHours(h);
        return {
          label: `${String(h).padStart(2, "0")}:00`,
          start: start.getTime(),
          end: start.getTime() + 3_600_000 - 1,
        };
      });
    }
    if (days > 62) {
      const weeks: Bucket[] = [];
      const first = new Date(range.from);
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      first.setHours(0, 0, 0, 0);
      for (
        let t = first.getTime();
        t <= range.to.getTime();
        t += 7 * 86_400_000
      ) {
        const start = new Date(t);
        weeks.push({
          label: start.toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "short",
          }),
          start: t,
          end: t + 7 * 86_400_000 - 1,
        });
      }
      return weeks;
    }
    const last = new Date(range.to);
    last.setHours(0, 0, 0, 0);
    const first = new Date(range.from);
    first.setHours(0, 0, 0, 0);
    const count =
      Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(first);
      d.setDate(d.getDate() + i);
      return {
        label: d.toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "short",
        }),
        start: d.getTime(),
        end: d.getTime() + 86_400_000 - 1,
      };
    });
  }, [range]);

  const buckets = useMemo(() => {
    const arr = bucketDefs.map((b) => ({
      label: b.label,
      value: 0,
      keg: 0,
      kej: 0,
      media: 0,
    }));
    if (arr.length === 0) return arr;
    for (const l of data?.rows ?? []) {
      const t = new Date(l.timestamp_kirim).getTime();
      const idx = bucketDefs.findIndex((b) => t >= b.start && t <= b.end);
      if (idx === -1) continue;
      const b = arr[idx];
      b.value += 1;
      if (l.kategori === "kejadian") b.kej += 1;
      else b.keg += 1;
      b.media += (l.fotos?.length ?? 0) + (l.videos?.length ?? 0);
    }
    return arr;
  }, [bucketDefs, data]);

  const jenisTop = useMemo<Array<[string, number]>>(() => {
    const map = new Map<string, number>();
    for (const l of data?.rows ?? []) {
      const key = l.jenis?.nama ?? "Tanpa jenis";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [data]);

  // Semua NRP dalam periode → muat direktori personel sekali.
  const nrpSemua = useMemo(
    () =>
      Array.from(
        new Set(
          (data?.rows ?? []).flatMap((l) =>
            (l.nrp_pelapor ?? "")
              .split(",")
              .map((n) => n.trim())
              .filter(Boolean),
          ),
        ),
      ),
    [data],
  );
  const { data: personelMap = new Map<string, PersonelPolri>() } = useQuery({
    queryKey: ["personel-batch", nrpSemua],
    queryFn: () => cariPersonelBatch(nrpSemua),
    enabled: nrpSemua.length > 0,
    staleTime: Infinity,
  });

  /**
   * Personel teraktif: hitung PARTISIPASI — satu laporan dengan beberapa
   * NRP dihitung untuk tiap personel yang tercantum. Mengikuti periode &
   * cakupan pemantau (rows sudah terfilter RLS/scope di server).
   */
  const personelTop = useMemo<Array<{ label: string; nrp: string; jumlah: number }>>(() => {
    const map = new Map<string, number>();
    for (const l of data?.rows ?? []) {
      for (const n of (l.nrp_pelapor ?? "").split(",")) {
        const nrp = n.trim();
        if (nrp) map.set(nrp, (map.get(nrp) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([nrp, jumlah]) => ({
        nrp,
        jumlah,
        label: personelFormat(personelMap.get(nrp)) || `NRP ${nrp}`,
      }))
      .sort((a, b) => b.jumlah - a.jumlah)
      .slice(0, 10);
  }, [data, personelMap]);

  const spanDays = Math.max(
    1,
    Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000),
  );
  const prevSpanDays = Math.max(
    1,
    Math.round((pRange.to.getTime() - pRange.from.getTime()) / 86_400_000),
  );
  const curTotal = data?.total ?? 0;
  const curMedia = (data?.foto ?? 0) + (data?.video ?? 0);
  const avgCur = curTotal / spanDays;
  const avgPrev = prev ? prev.total / prevSpanDays : null;

  const kpis = [
    {
      label: "Total Laporan",
      value: curTotal,
      color: PALET[0],
      delta: deltaPct(curTotal, prev?.total),
      invert: false,
      decimals: 0,
      spark: buckets.map((b) => b.value),
    },
    {
      label: "Kegiatan",
      value: data?.kegiatan ?? 0,
      color: PALET[2],
      delta: deltaPct(data?.kegiatan ?? 0, prev?.kegiatan),
      invert: false,
      decimals: 0,
      spark: buckets.map((b) => b.keg),
    },
    {
      label: "Kejadian",
      value: data?.kejadian ?? 0,
      color: PALET[4],
      delta: deltaPct(data?.kejadian ?? 0, prev?.kejadian),
      invert: true,
      decimals: 0,
      spark: buckets.map((b) => b.kej),
    },
    {
      label: "Foto & Video",
      value: curMedia,
      color: PALET[1],
      delta: deltaPct(curMedia, prev ? prev.foto + prev.video : null),
      invert: false,
      decimals: 0,
      spark: buckets.map((b) => b.media),
    },
    {
      label: "Rata-rata per Hari",
      value: avgCur,
      color: PALET[3],
      delta: deltaPct(avgCur, avgPrev),
      invert: false,
      decimals: 1,
      spark: buckets.map((b) => b.value),
    },
  ];

  const scopeChip = (() => {
    const level = session?.accessLevel ?? "all";
    const key = (session?.scopeKey ?? "").trim().toLowerCase();
    if (!key) return null;
    if (level === "wilayah") return `Polsek ${wilayahLabel(key)}`;
    if (level === "fungsi") return unitLabel(key);
    return null;
  })();

  const tren = buckets.map((b) => ({ label: b.label, value: b.value }));

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900">
            📊 Statistik
            {scopeChip && (
              <span className="stx-scope-chip">🎯 {scopeChip}</span>
            )}
          </h1>
          <p className="text-sm text-slate-500">
            Ringkasan statistik laporan kegiatan &amp; kejadian.
          </p>
        </div>
        <div className="stx-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={preset === key}
              onClick={() => setPreset(key)}
              className={"stx-tab" + (preset === key ? " stx-tab-on" : "")}
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
              onChange={(e) =>
                setCustom((c) => ({ ...c, from: e.target.value }))
              }
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

      {loading && !data && (
        <div className="card animate-pulse py-12 text-center text-sm text-slate-500">
          Memuat statistik…
        </div>
      )}

      {data && (
        <>
          {/* Kartu ringkasan + sparkline */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {kpis.map((k) => (
              <KpiCard key={k.label} {...k} />
            ))}
          </div>

          <div
            className={
              tampilWilayah && tampilFungsi
                ? "grid gap-4 lg:grid-cols-12"
                : "space-y-4"
            }
          >
            {/* Per wilayah (polsek) — sembunyi untuk Kasat (fungsi) */}
            {tampilWilayah && (
              <section
                className={
                  tampilFungsi ? "card lg:col-span-7" : "card"
                }
              >
                <h2 className="font-bold text-slate-800">
                  Statistik per Wilayah
                </h2>
                <p className="stx-muted mb-2 text-[11px]">
                  Jumlah laporan tiap polsek
                </p>
                {data.perWilayah.length > 0 ? (
                  <WilayahBars key={periodKey} items={data.perWilayah} />
                ) : (
                  <p className="stx-empty">Belum ada data.</p>
                )}
              </section>
            )}

            {/* Per fungsi (satuan) — sembunyi untuk Kapolsek (wilayah) */}
            {tampilFungsi && (
              <section
                className={
                  tampilWilayah ? "card lg:col-span-5" : "card"
                }
              >
                <h2 className="font-bold text-slate-800">
                  Statistik per Fungsi
                </h2>
                <p className="stx-muted mb-2 text-[11px]">
                  Sebaran laporan menurut fungsi
                </p>
                {data.perUnit.length > 0 ? (
                  <DonutFungsi key={periodKey} items={data.perUnit} />
                ) : (
                  <p className="stx-empty">Belum ada data.</p>
                )}
              </section>
            )}

            {/* Tren */}
            <section className="card lg:col-span-8">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-800">
                    Tren Laporan Harian
                  </h2>
                  <p className="stx-muted text-[11px]">
                    Sentuh titik untuk melihat jumlah per periode
                  </p>
                </div>
                <span className="trend-live-badge">LIVE</span>
              </div>
              {tren.length > 0 ? (
                <TrendLine key={periodKey} points={tren} />
              ) : (
                <p className="stx-empty">Belum ada data.</p>
              )}
            </section>

            {/* Rasio kategori */}
            <section className="card lg:col-span-4">
              <h2 className="font-bold text-slate-800">
                Rasio Kegiatan &amp; Kejadian
              </h2>
              <p className="stx-muted mb-2 text-[11px]">
                Komposisi kategori laporan
              </p>
              <GaugeKategori
                kegiatan={data.kegiatan}
                kejadian={data.kejadian}
              />
            </section>

            {/* Jenis teratas */}
            <section className="card lg:col-span-6">
              <h2 className="font-bold text-slate-800">
                Jenis Laporan Teratas
              </h2>
              <p className="stx-muted mb-3 text-[11px]">
                Peringkat berdasarkan jumlah
              </p>
              <RankJenis key={periodKey} items={jenisTop} />
            </section>

            {/* Personel teraktif — partisipasi laporan per NRP (LAPBUL) */}
            <section className="card lg:col-span-6">
              <h2 className="font-bold text-slate-800">
                Personel Teraktif
              </h2>
              <p className="stx-muted mb-3 text-[11px]">
                Anggota paling aktif melaporkan (ikut mencatat dalam laporan)
              </p>
              <RankPersonel key={periodKey} items={personelTop} />
            </section>

            {/* Heatmap jam ramai */}
            <section className="card lg:col-span-6">
              <h2 className="font-bold text-slate-800">Jam Paling Ramai</h2>
              <p className="stx-muted mb-3 text-[11px]">
                Intensitas laporan per jam, Senin sampai Minggu
              </p>
              <HeatmapJam rows={data.rows} />
            </section>

            {/* Feed terbaru */}
            <section className="card lg:col-span-12">
              <h2 className="font-bold text-slate-800">Laporan Terbaru</h2>
              <p className="stx-muted mb-3 text-[11px]">
                Masuk secara langsung
              </p>
              <FeedTerbaru rows={data.rows} now={now} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
