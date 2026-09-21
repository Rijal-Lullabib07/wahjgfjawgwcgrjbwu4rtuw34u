/**
 * Tab 📊 Monitoring — tab utama pemantau.
 *
 * Terdiri dari:
 *  - Header command center + kartu ringkasan (total pelapor, laporan masuk,
 *    sudah/belum lapor) — dipindah dari tab Monitoring lama.
 *  - Folder per Polsek (dipindah dari tab 📁 Folder): unit/satuan masuk ke
 *    folder Polseknya masing-masing.
 *  - Kartu laporan dengan player video, unduh foto/video, dan salin keterangan.
 *
 * Semua data folder lewat RPC di Supabase (db_supabase.sql bagian 8):
 *   - folder_overview()     → daftar folder + jumlah hari ini + waktu terakhir + "N baru"
 *   - folder_laporan(key)   → isi laporan sebuah folder (RLS tetap berlaku)
 *   - mark_folder_read(key) → tandai folder sudah dibuka (badge hilang)
 *
 * folder_key (harus sama dengan konvensi SQL):
 *   polsek:<wilayah> | unit:<wilayah>:<unit> | satuan:<unit> | arsip:<wilayah>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SessionUser } from "../../types";
import {
  fetchFolderLaporan,
  fetchFolderOverview,
  formatWaktuWib,
  markFolderRead,
  type FolderLaporanRow,
  type FolderRow,
} from "../../lib/folders";
import {
  fetchLaporan,
  fetchReguList,
  fotoUrl,
  namaFileUnduhan,
  unduhFileStorage,
  videoUrl,
} from "../../lib/supabase/api";
import PlaceBadge from "../../components/PlaceBadge";
import type { TahapLaporan } from "../../types";

const TAHAP_LABEL: Record<TahapLaporan, string> = {
  awal: "Laporan Awal",
  update: "Update Situasi",
  lengkap: "Laporan Lengkap",
};

const TAHAP_BADGE: Record<TahapLaporan, string> = {
  awal: "bg-sky-500/15 text-sky-300",
  update: "bg-amber-500/15 text-amber-300",
  lengkap: "bg-emerald-500/15 text-emerald-300",
};

/** Badge kategori + tahap + jenis laporan. */
function KategoriBadge({ item }: { item: FolderLaporanRow }) {
  if (!item.kategori) return null;
  const kategori = (
    <span
      className={
        "badge " +
        (item.kategori === "kejadian"
          ? "bg-red-500/15 text-red-300"
          : "bg-sky-500/15 text-sky-300")
      }
    >
      {item.kategori === "kejadian" ? "⚡ Kejadian" : "📋 Kegiatan"}
    </span>
  );
  const tahap = item.tahap ? (
    <span className={"badge " + TAHAP_BADGE[item.tahap]}>
      {TAHAP_LABEL[item.tahap]}
    </span>
  ) : null;
  const jenis = item.jenis_nama ? (
    <span className="badge bg-white/[0.06] text-slate-300">{item.jenis_nama}</span>
  ) : null;
  const lanjutan =
    item.parent_id || (item.child_count ?? 0) > 0 ? (
      <span className="badge bg-gold-400/15 text-gold-300">
        {item.parent_id
          ? "↳ lanjutan"
          : `🧵 ${item.child_count} turunan`}
      </span>
    ) : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {kategori}
      {tahap}
      {jenis}
      {lanjutan}
    </div>
  );
}

interface Props {
  session: SessionUser;
  /** Naik tiap ada perubahan realtime → badge & ringkasan dihitung ulang. */
  refreshKey: number;
  /** folder_key dari popup "Buka laporan" / notifikasi sistem. */
  openFolderKey: string | null;
  onOpenHandled: () => void;
}

function BaruBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-red-500 px-2.5 py-1 text-xs font-bold text-white shadow">
      {count} baru
    </span>
  );
}

function SyncBadge({ status }: { status: string }) {
  if (status === "synced") {
    return (
      <span className="badge bg-emerald-500/15 text-emerald-300">✓ synced</span>
    );
  }
  if (status === "failed") {
    return <span className="badge bg-red-500/15 text-red-300">✗ gagal</span>;
  }
  return <span className="badge bg-amber-500/15 text-amber-300">⏳ pending</span>;
}

function FolderStats({ row }: { row: FolderRow }) {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <span>📅 {row.today_count} hari ini</span>
      <span>🕘 terakhir: {formatWaktuWib(row.last_at)}</span>
    </div>
  );
}

/** Tombol unduh file Storage via blob agar langsung muncul dialog simpan. */
function UnduhButton({
  storagePath,
  className,
}: {
  storagePath: string;
  className?: string;
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

  return (
    <button
      type="button"
      disabled={state === "proses"}
      onClick={() => void unduh()}
      className={
        className ??
        "text-[11px] font-semibold text-sky-300 hover:text-white disabled:opacity-60"
      }
    >
      {state === "proses"
        ? "⏳ Mengunduh…"
        : state === "gagal"
          ? "⚠ Gagal — coba lagi"
          : "⬇ Unduh"}
    </button>
  );
}

/** Player video + tombol unduh. */
function VideoPreview({
  path,
  durationSeconds,
}: {
  path: string;
  durationSeconds: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-sky-500/30 bg-black">
      <video
        src={videoUrl(path)}
        controls
        preload="metadata"
        className="aspect-video w-full object-cover"
      />
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="text-[10px] text-sky-200">
          🎥 Video{durationSeconds ? ` · ${durationSeconds} detik` : ""}
        </span>
        <UnduhButton storagePath={path} />
      </div>
    </div>
  );
}

/** Tombol salin keterangan laporan (clipboard API + fallback lama). */
function CopyNoteButton({ note }: { note: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    setFailed(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(note);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = note;
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
        "shrink-0 rounded-lg border px-2 py-1 text-[11px] font-semibold transition " +
        (copied
          ? "border-emerald-500/40 text-emerald-300"
          : failed
            ? "border-red-500/40 text-red-300"
            : "border-navy-600 text-sky-300 hover:bg-navy-800 hover:text-white")
      }
    >
      {copied ? "Tersalin ✓" : failed ? "Gagal salin" : "📋 Salin"}
    </button>
  );
}

function LaporanCard({ item }: { item: FolderLaporanRow }) {
  return (
    <div className="card border-white/10 bg-[#122947]/80 shadow-[0_14px_35px_rgba(2,12,25,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">
            {item.nama_regu}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {formatWaktuWib(item.timestamp_kirim)}
          </div>
        </div>
        <SyncBadge status={item.status_sync} />
      </div>
      <KategoriBadge item={item} />
      {item.perihal && (
        <div className="mt-2 text-xs font-semibold text-slate-200">
          {item.perihal}
        </div>
      )}
      {item.catatan && (
        <div className="mt-3 rounded-xl border border-white/5 bg-navy-950/50 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap text-sm text-slate-300">
              {item.catatan}
            </p>
            <CopyNoteButton note={item.catatan} />
          </div>
        </div>
      )}
      {item.fotos.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {item.fotos.map((foto) => (
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
              <UnduhButton
                storagePath={foto.storage_path}
                className="block w-full border-t border-navy-700 px-2 py-1 text-center text-[11px] font-semibold text-sky-300 hover:bg-navy-800 hover:text-white disabled:opacity-60"
              />
            </div>
          ))}
        </div>
      )}
      {item.videos.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {item.videos.map((video) => (
            <VideoPreview
              key={video.id}
              path={video.storage_path}
              durationSeconds={video.duration_seconds}
            />
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <PlaceBadge lat={item.latitude} lng={item.longitude} />
      </div>
    </div>
  );
}

/** Header command center + kartu ringkasan (dipindah dari tab Monitoring lama). */
function MonitoringIntro({
  refreshKey,
}: {
  refreshKey: number;
}) {
  const [stats, setStats] = useState<{
    total: number;
    laporan: number;
    sudah: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [reguList, laporanList] = await Promise.all([
          fetchReguList(),
          fetchLaporan({ limit: 200 }),
        ]);
        if (!active) return;
        const sudah = new Set(laporanList.map((l) => l.regu_id)).size;
        setStats({
          total: reguList.length,
          laporan: laporanList.length,
          sudah,
        });
      } catch {
        /* ringkasan tidak kritikal — biarkan "—" */
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const belum = stats ? stats.total - stats.sudah : null;

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl border border-gold-400/15 bg-gradient-to-br from-[#142d4d] via-[#102541] to-[#0d1b32] p-5 shadow-[0_20px_55px_rgba(2,12,25,0.25)] sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-400/10 blur-3xl" />
        <div className="relative">
          <div className="eyebrow">Command center / monitoring</div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Pantau giat lapangan
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300/80 sm:text-base">
            Laporan dari tiap unit/satuan masuk ke folder Polsek/satuannya
            masing-masing. Klik folder untuk melihat isinya.
          </p>
          <div className="mt-5">
            <div className="status-live w-fit">Realtime aktif</div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="card relative overflow-hidden border-gold-400/15 bg-white/[0.04] p-4 sm:p-5">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-400 to-amber-200" />
          <div className="text-xs font-semibold text-slate-400">Total pelapor</div>
          <div className="mt-3 text-2xl font-extrabold tracking-tight text-white">
            {stats ? stats.total : "—"}
          </div>
        </div>
        <div className="card relative overflow-hidden border-sky-400/15 bg-white/[0.04] p-4 sm:p-5">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 to-cyan-200" />
          <div className="text-xs font-semibold text-slate-400">Laporan terakhir</div>
          <div className="mono mt-3 text-2xl font-bold text-sky-300">
            {stats ? stats.laporan : "—"}
          </div>
        </div>
        <div className="card relative overflow-hidden border-emerald-400/15 bg-white/[0.04] p-4 sm:p-5">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-200" />
          <div className="text-xs font-semibold text-slate-400">Sudah lapor</div>
          <div className="mt-3 text-2xl font-extrabold tracking-tight text-emerald-400">
            {stats ? `${stats.sudah}/${stats.total}` : "—"}
          </div>
        </div>
        <div className="card relative overflow-hidden border-red-400/15 bg-white/[0.04] p-4 sm:p-5">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-400 to-rose-200" />
          <div className="text-xs font-semibold text-slate-400">Belum lapor</div>
          <div className="mt-3 text-2xl font-extrabold tracking-tight text-red-400">
            {belum ?? "—"}
          </div>
        </div>
      </div>
    </>
  );
}

export default function MonitoringScreen({
  session,
  refreshKey,
  openFolderKey,
  onOpenHandled,
}: Props) {
  const [rows, setRows] = useState<FolderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPolsek, setExpandedPolsek] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<FolderLaporanRow[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const scope = session.accessLevel ?? "all";
  const wilayahScope = session.scopeKey ?? null;

  const load = useCallback(async () => {
    try {
      setRows(await fetchFolderOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const openDetail = useCallback(
    async (key: string) => {
      setDetailKey(key);
      setDetailRows(null);
      setDetailLoading(true);
      setExpandedPolsek(null);
      // Badge "N baru" hilang saat folder dibuka.
      void markFolderRead(key);
      try {
        setDetailRows(await fetchFolderLaporan(key));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
        void load();
      }
    },
    [load],
  );

  // Popup "Buka laporan" / tombol notifikasi meminta folder tertentu.
  useEffect(() => {
    if (openFolderKey) {
      void openDetail(openFolderKey);
      onOpenHandled();
    }
  }, [openFolderKey, openDetail, onOpenHandled]);

  // Deep link dari notifikasi sistem: /?folder=<key>
  useEffect(() => {
    const key = searchParams.get("folder");
    if (key) {
      setSearchParams({}, { replace: true });
      void openDetail(key);
    }
  }, [searchParams, setSearchParams, openDetail]);

  const byParent = useMemo(() => {
    const map = new Map<string, FolderRow[]>();
    for (const row of rows ?? []) {
      if (!row.parent_key) continue;
      const list = map.get(row.parent_key) ?? [];
      list.push(row);
      map.set(row.parent_key, list);
    }
    return map;
  }, [rows]);

  const polsekRows = useMemo(
    () => (rows ?? []).filter((r) => r.folder_kind === "polsek"),
    [rows],
  );
  const satuanRows = useMemo(
    () => (rows ?? []).filter((r) => r.folder_kind === "satuan"),
    [rows],
  );

  const expandPolsek = (key: string) => {
    // Badge folder polsek hilang saat dibuka (di-expand).
    void markFolderRead(key);
    setExpandedPolsek((cur) => (cur === key ? null : key));
    void load();
  };

  const closeDetail = () => {
    setDetailKey(null);
    setDetailRows(null);
    void load();
  };

  // ---------- Tampilan isi folder ----------
  if (detailKey) {
    const label =
      (rows ?? []).find((r) => r.folder_key === detailKey)?.folder_label ??
      detailKey;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={closeDetail}
            className="rounded-xl border border-navy-700 px-3 py-2 text-sm text-slate-300 transition hover:text-white"
          >
            ← Kembali
          </button>
          <h2 className="truncate text-lg font-bold text-white">{label}</h2>
        </div>
        {detailLoading && (
          <div className="card text-sm text-slate-400">Memuat laporan…</div>
        )}
        {!detailLoading && (detailRows ?? []).length === 0 && (
          <div className="card text-sm text-slate-400">
            Belum ada laporan di folder ini.
          </div>
        )}
        <div className="space-y-3">
          {(detailRows ?? []).map((item) => (
            <LaporanCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-500/30 text-sm text-red-300">
        {error}
        <button
          onClick={() => void load()}
          className="ml-3 underline hover:no-underline"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (rows === null) {
    return <div className="card text-sm text-slate-400">Memuat folder…</div>;
  }

  // ---------- Kapolsek: langsung masuk folder Polseknya ----------
  if (scope === "wilayah" && wilayahScope) {
    const polsekKey = `polsek:${wilayahScope}`;
    const polsekRow = polsekRows.find((r) => r.folder_key === polsekKey);
    const children = byParent.get(polsekKey) ?? [];
    return (
      <div className="space-y-6">
        <MonitoringIntro refreshKey={refreshKey} />
        <div className="space-y-4">
          <div className="card relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gold-400" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Folder Polsek Anda</div>
                <h2 className="mt-1 text-lg font-bold text-white">
                  {polsekRow?.folder_label ?? `Polsek ${wilayahScope}`}
                </h2>
              </div>
              <BaruBadge count={polsekRow?.new_count ?? 0} />
            </div>
            {polsekRow && (
              <div className="mt-2">
                <FolderStats row={polsekRow} />
              </div>
            )}
          </div>
          {children.length === 0 && (
            <div className="card text-sm text-slate-400">
              Belum ada folder unit di Polsek ini.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {children.map((child) => (
              <button
                key={child.folder_key}
                onClick={() => void openDetail(child.folder_key)}
                className="card text-left transition hover:border-gold-400/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-200">
                    📁 {child.folder_label}
                  </span>
                  <BaruBadge count={child.new_count} />
                </div>
                <div className="mt-2">
                  <FolderStats row={child} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Kasat: satuan + folder unitnya di tiap Polsek ----------
  if (scope === "fungsi") {
    const unitRows = (rows ?? []).filter((r) => r.folder_kind === "unit");
    const groups = new Map<string, FolderRow[]>();
    for (const row of unitRows) {
      const key = row.parent_key ?? "-";
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return (
      <div className="space-y-6">
        <MonitoringIntro refreshKey={refreshKey} />
        {satuanRows.length > 0 && (
          <section>
            <div className="eyebrow mb-3">Satuan Polres</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {satuanRows.map((row) => (
                <button
                  key={row.folder_key}
                  onClick={() => void openDetail(row.folder_key)}
                  className="card text-left transition hover:border-gold-400/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-200">
                      📁 {row.folder_label}
                    </span>
                    <BaruBadge count={row.new_count} />
                  </div>
                  <div className="mt-2">
                    <FolderStats row={row} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
        {unitRows.length > 0 && (
          <section>
            <div className="eyebrow mb-3">Pelapor tingkat Polsek</div>
            <div className="space-y-4">
              {[...groups.entries()].map(([parentKey, children]) => (
                <div key={parentKey}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {children[0]?.folder_label.split(" — ")[1] ?? parentKey}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {children.map((child) => (
                      <button
                        key={child.folder_key}
                        onClick={() => void openDetail(child.folder_key)}
                        className="card text-left transition hover:border-gold-400/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-slate-200">
                            📁 {child.folder_label.split(" — ")[0]}
                          </span>
                          <BaruBadge count={child.new_count} />
                        </div>
                        <div className="mt-2">
                          <FolderStats row={child} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {satuanRows.length === 0 && unitRows.length === 0 && (
          <div className="card text-sm text-slate-400">
            Tidak ada folder dalam cakupan Anda.
          </div>
        )}
      </div>
    );
  }

  // ---------- Kapolres / Wakapolres / Admin: dua tingkat ----------
  // Urutan: Satuan (Polres) di ATAS, folder Polsek di bawah.
  return (
    <div className="space-y-6">
      <MonitoringIntro refreshKey={refreshKey} />

      <section>
        <div className="eyebrow mb-3">Pelapor tingkat Polres</div>
        {satuanRows.length === 0 && (
          <div className="card text-sm text-slate-400">
            Belum ada folder satuan.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {satuanRows.map((row) => (
            <button
              key={row.folder_key}
              onClick={() => void openDetail(row.folder_key)}
              className="card text-left transition hover:border-gold-400/40"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold text-slate-200">
                  📁 {row.folder_label}
                </span>
                <BaruBadge count={row.new_count} />
              </div>
              <div className="mt-2">
                <FolderStats row={row} />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="eyebrow mb-3">Pelapor tingkat Polsek</div>
        {polsekRows.length === 0 && (
          <div className="card text-sm text-slate-400">
            Belum ada folder Polsek.
          </div>
        )}
        <div className="space-y-3">
          {polsekRows.map((row) => {
            const open = expandedPolsek === row.folder_key;
            const children = byParent.get(row.folder_key) ?? [];
            return (
              <div key={row.folder_key} className="card">
                <button
                  type="button"
                  onClick={() => expandPolsek(row.folder_key)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="text-sm font-semibold text-slate-200">
                    {open ? "📂" : "📁"} {row.folder_label}
                  </span>
                  <BaruBadge count={row.new_count} />
                </button>
                <div className="mt-2">
                  <FolderStats row={row} />
                </div>
                {open && (
                  <div className="mt-3 grid gap-2 border-t border-navy-700 pt-3 sm:grid-cols-2">
                    {children.length === 0 && (
                      <div className="text-xs text-slate-500">
                        Belum ada folder unit.
                      </div>
                    )}
                    {children.map((child) => (
                      <button
                        key={child.folder_key}
                        onClick={() => void openDetail(child.folder_key)}
                        className="rounded-xl border border-navy-700/70 bg-navy-900/60 px-3 py-2 text-left transition hover:border-gold-400/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm text-slate-300">
                            📁 {child.folder_label}
                          </span>
                          <BaruBadge count={child.new_count} />
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                          <span>📅 {child.today_count} hari ini</span>
                          <span>🕘 {formatWaktuWib(child.last_at)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
