import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Laporan, Regu } from "../../types";
import {
  fetchLaporan,
  fetchReguList,
  subscribeLaporan,
  fotoUrl,
  fotoDownloadUrl,
  videoUrl,
  videoDownloadUrl,
} from "../../lib/supabase/api";
import {
  getCurrentCycle,
  formatWaktu,
  FOTOS_PER_SIKLUS,
} from "../../lib/cycle";
import {
  reverseGeocode,
  cachedPlace,
  formatPlace,
  type PlaceInfo,
} from "../../lib/geo";
import { reguDisplayName, reguOrigin } from "../../lib/regu";

/** Badge lokasi: nama tempat (reverse geocoding), fallback koordinat. */
function PlaceBadge({ lat, lng }: { lat: number | null; lng: number | null }) {
  const [place, setPlace] = useState<PlaceInfo | null>(() =>
    cachedPlace(lat, lng),
  );

  useEffect(() => {
    if (lat == null || lng == null) return;
    const cached = cachedPlace(lat, lng);
    if (cached) {
      setPlace(cached);
      return;
    }
    let active = true;
    void reverseGeocode(lat, lng).then((p) => {
      if (active && p) setPlace(p);
    });
    return () => {
      active = false;
    };
  }, [lat, lng]);

  return (
    <span className="badge bg-navy-700 text-navy-100">
      📍 {formatPlace(place, lat, lng)}
    </span>
  );
}

/** URL foto langsung dari Supabase Storage (public bucket). */
function FotoThumb({ path }: { path: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-navy-600 bg-navy-900">
      <img
        src={fotoUrl(path)}
        alt="Foto giat"
        className="aspect-square w-full object-cover"
        loading="lazy"
      />
      <a
        href={fotoDownloadUrl(path)}
        download
        target="_blank"
        rel="noreferrer"
        className="block border-t border-navy-600 px-2 py-1.5 text-center text-[11px] font-semibold text-sky-300 hover:bg-navy-800 hover:text-white"
      >
        Download foto
      </a>
    </div>
  );
}

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
      <div className="px-2 py-1 text-[10px] text-sky-200">
        🎥 Video{durationSeconds ? ` · ${durationSeconds} detik` : ""}
      </div>
      <a
        href={videoDownloadUrl(path)}
        download
        target="_blank"
        rel="noreferrer"
        className="block border-t border-navy-700 px-2 py-1.5 text-center text-[11px] font-semibold text-sky-300 hover:bg-navy-800 hover:text-white"
      >
        Download video
      </a>
    </div>
  );
}

function StatusBadge({
  count,
  videoCount,
}: {
  count: number;
  videoCount: number;
}) {
  if (count >= FOTOS_PER_SIKLUS) {
    return (
      <span className="badge bg-emerald-500/15 text-emerald-300">
        ✅ Lengkap
      </span>
    );
  }
  if (videoCount > 0) {
    return (
      <span className="badge bg-sky-500/15 text-sky-300">
        🎥 Video terkirim
      </span>
    );
  }
  if (count > 0) {
    return (
      <span className="badge bg-amber-500/15 text-amber-300">
        ⏳ {count}/2 foto
      </span>
    );
  }
  return (
    <span className="badge bg-red-500/15 text-red-300">❌ Belum lapor</span>
  );
}

/**
 * Monitoring realtime, diklasifikasikan per pelapor:
 - Ringkasan status semua pelapor dalam grid (klik kartu → fokus pelapor)
 - Tab filter per pelapor + panel detail laporan pelapor terpilih
 */
export default function MonitoringScreen() {
  const queryClient = useQueryClient();
  const cycle = useMemo(() => getCurrentCycle(), [Date.now() / 60000]);
  const [reguFilter, setReguFilter] = useState<string>("semua");
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const {
    data: reguList = [],
    error: reguError,
  } = useQuery({
    queryKey: ["regu-list"],
    queryFn: fetchReguList,
  });

  const {
    data: laporanList = [],
    error: laporanError,
  } = useQuery({
    queryKey: ["laporan-recent"],
    queryFn: () => fetchLaporan({ limit: 200 }),
  });

  // Realtime: invalidasi query saat ada perubahan di backend
  useEffect(() => {
    return subscribeLaporan(() => {
      void queryClient.invalidateQueries({ queryKey: ["laporan-recent"] });
    });
  }, [queryClient]);

  // Refresh tiap 30 detik sebagai fallback
  useEffect(() => {
    const t = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["laporan-recent"] });
    }, 30000);
    return () => clearInterval(t);
  }, [queryClient]);

  // Status per regu di siklus berjalan
  const statusPerRegu = useMemo(() => {
    const map = new Map<
      string,
      { regu: Regu; count: number; videoCount: number; lastAt: string | null }
    >();
    for (const r of reguList) {
      map.set(r.id, { regu: r, count: 0, videoCount: 0, lastAt: null });
    }
    for (const l of laporanList) {
      const entry = map.get(l.regu_id);
      if (!entry) continue;
      if (l.siklus_ke === cycle.siklusKe) {
        entry.count += l.fotos?.length ?? 0;
        entry.videoCount += l.videos?.length ?? 0;
        const t = l.timestamp_kirim;
        if (!entry.lastAt || t > entry.lastAt) entry.lastAt = t;
      }
    }
    return [...map.values()].sort((a, b) =>
      a.regu.nama_regu.localeCompare(b.regu.nama_regu),
    );
  }, [reguList, laporanList, cycle.siklusKe]);

  const belumLapor = statusPerRegu.filter((s) => s.count === 0).length;

  // Klasifikasi per regu: laporan dikelompokkan dalam Map regu_id → laporan[]
  const laporanPerRegu = useMemo(() => {
    const map = new Map<string, Laporan[]>();
    for (const l of laporanList) {
      const arr = map.get(l.regu_id);
      if (arr) arr.push(l);
      else map.set(l.regu_id, [l]);
    }
    return map;
  }, [laporanList]);

  // Regu terpilih: dari filter, atau otomatis regu yang belum lapor paling awal
  const selected = useMemo(() => {
    if (reguFilter !== "semua") {
      return statusPerRegu.find((s) => s.regu.id === reguFilter) ?? null;
    }
    return null;
  }, [reguFilter, statusPerRegu]);

  const selectedLaporan = selected
    ? (laporanPerRegu.get(selected.regu.id) ?? []).slice(0, 12)
    : [];
  const queryError = reguError ?? laporanError;

  const copyReportNote = async (laporan: Laporan) => {
    const note = laporan.catatan?.trim();
    if (!note) return;
    setCopyError(null);
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
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Keterangan tidak dapat disalin");
    }
    setCopiedReportId(laporan.id);
    window.setTimeout(() => setCopiedReportId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {queryError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Gagal memuat data pemantauan:{" "}
          {queryError instanceof Error
            ? queryError.message
            : typeof queryError === "object" && queryError !== null
              ? JSON.stringify(queryError)
              : String(queryError)}
        </div>
      )}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Command center / monitoring</div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Pantau giat lapangan
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            Setiap pelapor menampilkan asal Polsek. Jika tertulis “Polsek belum
            ditentukan”, data akun tersebut belum memiliki mapping Polsek.
          </p>
        </div>
        <div className="status-live">Realtime aktif</div>
      </section>

      {/* Ringkasan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gold-400" />
          <div className="text-xs text-slate-400">Siklus berjalan</div>
          <div className="mt-2 text-lg font-bold">{cycle.label}</div>
        </div>
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-sky-400" />
          <div className="text-xs text-slate-400">Sisa waktu</div>
          <div className="mono mt-2 text-lg font-bold text-sky-300">
            {String(cycle.minutesLeft).padStart(2, "0")} menit
          </div>
        </div>
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-emerald-400" />
          <div className="text-xs text-slate-400">Sudah lapor</div>
          <div className="mt-2 text-lg font-bold text-emerald-400">
            {statusPerRegu.length - belumLapor}/{statusPerRegu.length}
          </div>
        </div>
        <div className="card relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-red-400" />
          <div className="text-xs text-slate-400">Belum lapor</div>
          <div className="mt-2 text-lg font-bold text-red-400">
            {belumLapor}
          </div>
        </div>
      </div>

      {/* Grid status pelapor — klik untuk fokus ke pelapor tersebut */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="eyebrow">Coverage</div>
            <h2 className="mt-1 font-semibold">
              Status Pelapor{" "}
              <span className="font-normal text-slate-500">
                / {cycle.label}
              </span>
            </h2>
          </div>
          <span className="mono text-xs text-slate-500">
            {statusPerRegu.length} pelapor aktif
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {statusPerRegu.map(({ regu, count, videoCount, lastAt }) => (
            <button
              key={regu.id}
              onClick={() =>
                setReguFilter((prev) => (prev === regu.id ? "semua" : regu.id))
              }
              className={
                "card flex items-center justify-between gap-3 text-left transition " +
                (reguFilter === regu.id
                  ? "ring-2 ring-gold-400/70"
                  : "hover:border-navy-500 hover:bg-navy-800")
              }
            >
              <div>
                <div className="font-semibold">{reguDisplayName(regu)}</div>
                <div className="text-xs text-slate-400">
                  {lastAt
                    ? "Terakhir kirim " + formatWaktu(lastAt)
                    : "Belum ada laporan"}
                </div>
              </div>
              <StatusBadge count={count} videoCount={videoCount} />
            </button>
          ))}
          {statusPerRegu.length === 0 && (
            <div className="card text-sm text-slate-400">
              Memuat data pelapor…
            </div>
          )}
        </div>
      </section>

      {/* Panel detail per pelapor yang dipilih */}
      {selected && (
        <section className="rounded-2xl border border-gold-400/30 bg-navy-800/40 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-gold-400">
                📋 {reguDisplayName(selected.regu)}
              </h2>
              <p className="text-xs font-medium text-gold-300">
                Asal: {reguOrigin(selected.regu)}
              </p>
              <p className="text-xs text-slate-400">
                {selectedLaporan.length} laporan terakhir · kode{" "}
                {selected.regu.kode_login}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge
                count={selected.count}
                videoCount={selected.videoCount}
              />
              <button
                onClick={() => setReguFilter("semua")}
                className="rounded-lg px-2.5 py-1 text-xs text-slate-400 hover:text-white"
              >
                ✕ Tutup
              </button>
            </div>
          </div>

          {selectedLaporan.length === 0 ? (
            <p className="text-sm text-slate-400">
              Belum ada laporan tersimpan untuk pelapor ini.
            </p>
          ) : (
            <div className="space-y-4">
              {selectedLaporan.map((l: Laporan) => (
                <div key={l.id} className="card">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      Siklus {l.siklus_ke} · {formatWaktu(l.timestamp_kirim)}
                    </div>
                    <PlaceBadge lat={l.latitude} lng={l.longitude} />
                  </div>
                  {l.catatan && (
                    <div className="mb-3 rounded-xl border border-navy-600 bg-navy-900/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="whitespace-pre-wrap text-xs text-slate-300">
                          💬 {l.catatan}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            void copyReportNote(l).catch(() =>
                              setCopyError("Keterangan tidak dapat disalin."),
                            )
                          }
                          className="shrink-0 rounded-lg border border-navy-600 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-navy-800 hover:text-white"
                        >
                          {copiedReportId === l.id
                            ? "Tersalin"
                            : "Salin keterangan"}
                        </button>
                      </div>
                      {copyError && copiedReportId !== l.id && (
                        <p className="mt-2 text-[11px] text-red-300">
                          {copyError}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(l.fotos ?? []).map((f) => (
                      <div key={f.id}>
                        <FotoThumb path={f.storage_path} />
                        <div className="mt-1 text-[10px] text-slate-500">
                          Foto {f.urutan_foto} · 📍{" "}
                          {formatPlace(
                            cachedPlace(f.watermark_lat, f.watermark_lng),
                            f.watermark_lat,
                            f.watermark_lng,
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(l.videos ?? []).length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {(l.videos ?? []).map((video) => (
                        <VideoPreview
                          key={video.id}
                          path={video.storage_path}
                          durationSeconds={video.duration_seconds}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Feed foto terbaru (semua pelapor) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Feed Foto Terbaru</h2>
          <span className="badge bg-navy-700 text-navy-100">
            <span className="anim-pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Realtime aktif
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {laporanList.slice(0, 24).map((l: Laporan) =>
            (l.fotos ?? []).map((f) => (
              <button
                key={f.id}
                onClick={() => setReguFilter(l.regu_id)}
                className="card p-2 text-left transition hover:border-gold-400/50"
                title={`Lihat semua laporan ${l.regu?.nama_regu ?? "pelapor"} (${l.regu ? reguOrigin(l.regu) : "asal tidak diketahui"})`}
              >
                <FotoThumb path={f.storage_path} />
                <div className="mt-2 text-xs font-semibold">
                  {l.regu ? reguDisplayName(l.regu) : "Pelapor — Asal tidak diketahui"}
                </div>
                <div className="text-[11px] text-slate-400">
                  Siklus {l.siklus_ke} · {formatWaktu(l.timestamp_kirim)}
                </div>
                <div className="text-[11px] text-slate-500">
                  {formatPlace(
                    cachedPlace(f.watermark_lat, f.watermark_lng),
                    f.watermark_lat,
                    f.watermark_lng,
                  )}
                </div>
              </button>
            )),
          )}
        </div>
        {laporanList.length === 0 && (
          <div className="card text-sm text-slate-400">
            Belum ada foto masuk. Laporan dari pelapor akan muncul otomatis di
            sini.
          </div>
        )}
      </section>
    </div>
  );
}
