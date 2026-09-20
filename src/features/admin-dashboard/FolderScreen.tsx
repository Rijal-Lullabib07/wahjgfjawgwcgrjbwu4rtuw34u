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
import { fotoUrl } from "../../lib/supabase/api";

interface Props {
  session: SessionUser;
  /** Naik tiap ada perubahan realtime → badge dihitung ulang. */
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

function LaporanCard({ item }: { item: FolderLaporanRow }) {
  const lokasi =
    item.latitude != null && item.longitude != null
      ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`
      : null;
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">
            {item.nama_regu}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {formatWaktuWib(item.timestamp_kirim)} · siklus {item.siklus_ke}
          </div>
        </div>
        <SyncBadge status={item.status_sync} />
      </div>
      {item.catatan && (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-navy-900/70 px-3 py-2 text-sm text-slate-300">
          {item.catatan}
        </p>
      )}
      {item.fotos.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {item.fotos.map((foto) => (
            <a
              key={foto.id}
              href={fotoUrl(foto.storage_path)}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg border border-navy-700"
            >
              <img
                src={fotoUrl(foto.storage_path)}
                alt={`Foto ${foto.urutan_foto}`}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {item.videos.length > 0 && (
          <span className="badge bg-navy-700 text-navy-100">
            🎥 {item.videos.length} video
          </span>
        )}
        {lokasi && <span>📍 {lokasi}</span>}
      </div>
    </div>
  );
}

export default function FolderScreen({
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
            <div className="eyebrow mb-3">Folder unit di tiap Polsek</div>
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
  return (
    <div className="space-y-6">
      <section>
        <div className="eyebrow mb-3">Tingkat Polsek</div>
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

      <section>
        <div className="eyebrow mb-3">Tingkat Satuan (Polres)</div>
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
    </div>
  );
}
