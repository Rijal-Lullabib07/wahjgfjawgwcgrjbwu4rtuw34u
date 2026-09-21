import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  fetchLaporan,
  fetchLokasiPelapor,
  subscribePosisi,
  type LokasiPelapor,
} from "../../lib/supabase/api";
import { reguDisplayName } from "../../lib/regu";
import { namaTempat, cachedNamaTempat, type NamaTempat } from "../../lib/mapPlace";
import { useGeolocation } from "../regu-capture/useGeolocation";

interface Props {
  refreshKey: number;
  /** Posisi GPS sendiri juga ditampilkan (default: ya). */
  showSelf?: boolean;
}

/** Marker titik berwarna via divIcon (tanpa aset gambar). */
function buatIcon(kategori: string): L.DivIcon {
  const warna = kategori === "kejadian" ? "#dc2626" : "#2563eb";
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${warna};border:3px solid white;box-shadow:0 1px 6px rgba(15,23,42,.4)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/** Marker posisi sendiri: titik hijau dengan ring putih. */
function buatIconDiri(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#10b981;border:3px solid white;box-shadow:0 0 0 6px rgba(16,185,129,.25),0 1px 6px rgba(15,23,42,.4)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/**
 * Status kehadiran personel dari usia posisi:
 *  - ≤ 2 menit  → live (hijau, denyut)
 *  - ≤ 15 menit → baru saja (indigo)
 *  - > 15 menit → offline / terakhir (abu-abu)
 */
function statusUsia(iso: string): { label: string; warna: string; live: boolean } {
  const usia = Date.now() - new Date(iso).getTime();
  const menit = Math.floor(usia / 60_000);
  if (menit <= 2) return { label: "Live — sekarang", warna: "#16a34a", live: true };
  if (menit <= 15)
    return { label: `Aktif ${menit} menit lalu`, warna: "#4f46e5", live: false };
  if (menit < 1440)
    return { label: `Terakhir ${menit} menit lalu`, warna: "#64748b", live: false };
  const jam = Math.floor(menit / 60);
  return { label: `Terakhir ${jam} jam lalu`, warna: "#94a3b8", live: false };
}

/** Cache ikon personel per kunci (nama+warna) — cegah marker flicker. */
const iconPelaporCache = new Map<string, L.DivIcon>();

/** Marker personel: pion berwarna sesuai status dengan pita nama. */
function buatIconPelapor(nama: string, warna: string): L.DivIcon {
  const key = `${nama}|${warna}`;
  const cached = iconPelaporCache.get(key);
  if (cached) return cached;
  const miring = Math.round((Math.random() * 10 - 5) * 10) / 10;
  const denyut = warna === "#16a34a" ? `<circle cx="0" cy="0" r="0" />` : "";
  void denyut;
  const icon = L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(15,23,42,.45))">
      <div style="background:${warna};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;border:1.5px solid #fff;white-space:nowrap;max-width:130px;overflow:hidden;text-overflow:ellipsis">${nama.replace(/"/g, "&quot;")}</div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${warna};transform:rotate(${miring}deg)"></div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
  iconPelaporCache.set(key, icon);
  return icon;
}

/** Popup body personel dengan nama tempat (POI/jalan) yang dimuat async. */
function PopupPersonel({ p }: { p: LokasiPelapor }) {
  const [tempat, setTempat] = useState<NamaTempat | null>(() =>
    cachedNamaTempat(p.latitude, p.longitude),
  );
  const status = statusUsia(p.diupdate_pada);

  useEffect(() => {
    if (tempat) return;
    let cancelled = false;
    void namaTempat(p.latitude, p.longitude).then((t) => {
      if (!cancelled && t) setTempat(t);
    });
    return () => {
      cancelled = true;
    };
  }, [p.latitude, p.longitude, tempat]);

  return (
    <div style={{ minWidth: 210 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: status.warna,
          marginBottom: 2,
        }}
      >
        👮 PERSONEL · {status.label}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.nama_regu}</div>
      <div style={{ fontSize: 12, color: "#475569" }}>
        {p.wilayah_key
          ? `Polsek ${p.wilayah_key}`
          : p.unit_key
            ? `Satuan Polres: ${p.unit_key}`
            : "—"}
      </div>
      <div style={{ fontSize: 12, color: "#0f172a", marginTop: 4 }}>
        📍 {tempat ? tempat.nama : "Mencari nama tempat…"}
      </div>
      {tempat?.keterangan && (
        <div style={{ fontSize: 11, color: "#64748b" }}>{tempat.keterangan}</div>
      )}
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
        Update posisi: {new Date(p.diupdate_pada).toLocaleTimeString("id-ID")}
        {p.accuracy_m != null ? ` · ±${Math.round(p.accuracy_m)} m` : ""}
      </div>
    </div>
  );
}

/**
 * Peta Kegiatan — sebaran lokasi laporan (GPS) di peta OpenStreetMap.
 * Biru = kegiatan, merah = kejadian, pion = posisi live personel
 * (realtime dari tabel `posisi`), hijau = posisi sendiri.
 */
export default function PetaScreen({ refreshKey, showSelf = true }: Props) {
  const [kategori, setKategori] = useState<"all" | "kegiatan" | "kejadian">("all");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchLaporan>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pelapor, setPelapor] = useState<LokasiPelapor[] | null>(null);
  const [tampilPelapor, setTampilPelapor] = useState(true);
  const [tampilDiri, setTampilDiri] = useState(showSelf);
  // GPS sendiri: hook yang sama dengan sisi pelapor (hanya untuk menampilkan
  // posisi pemantau di peta — tidak dikirim ke mana pun).
  const geo = useGeolocation(tampilDiri);
  /** Naik tiap ada perubahan posisi realtime → muat ulang daftar personel. */
  const [posisiTick, setPosisiTick] = useState(0);

  useEffect(() => {
    let active = true;
    const from = new Date();
    from.setDate(from.getDate() - 30);
    from.setHours(0, 0, 0, 0);
    void (async () => {
      try {
        const data = await fetchLaporan({ from, limit: 1000 });
        if (!active) return;
        setRows(data);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const loadPelapor = useCallback(async () => {
    try {
      setPelapor(await fetchLokasiPelapor());
    } catch {
      // Layer personel opsional — kegagalan tidak menggagalkan peta.
      setPelapor([]);
    }
  }, []);

  useEffect(() => {
    void loadPelapor();
  }, [loadPelapor, refreshKey, posisiTick]);

  // Realtime: setiap perubahan tabel `posisi` → muat ulang personel.
  useEffect(() => {
    try {
      return subscribePosisi(() => setPosisiTick((t) => t + 1));
    } catch {
      return undefined;
    }
  }, []);

  const points = useMemo(
    () =>
      (rows ?? []).filter(
        (l) =>
          l.latitude != null &&
          l.longitude != null &&
          (kategori === "all" || l.kategori === kategori),
      ),
    [rows, kategori],
  );

  const liveCount = useMemo(
    () => (pelapor ?? []).filter((p) => statusUsia(p.diupdate_pada).live).length,
    [pelapor],
  );

  const center = useMemo<[number, number]>(() => {
    if (tampilPelapor && (pelapor ?? []).length > 0) {
      const p = (pelapor ?? [])[0];
      return [p.latitude, p.longitude];
    }
    if (points.length === 0) return [-6.706, 107.443]; // Purwakarta
    const lat = points.reduce((a, l) => a + (l.latitude ?? 0), 0) / points.length;
    const lng = points.reduce((a, l) => a + (l.longitude ?? 0), 0) / points.length;
    return [lat, lng];
  }, [points, pelapor, tampilPelapor]);

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            📍 Peta Kegiatan
          </h1>
          <p className="text-sm text-slate-500">
            Sebaran lokasi laporan 30 hari terakhir ({points.length} titik)
            {pelapor && tampilPelapor
              ? ` · ${pelapor.length} personel (${liveCount} live)`
              : ""}
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "Semua"],
              ["kegiatan", "📋 Kegiatan"],
              ["kejadian", "⚡ Kejadian"],
            ] as Array<[typeof kategori, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setKategori(key)}
              className={
                "rounded-xl px-3.5 py-2 text-sm font-semibold transition " +
                (kategori === key
                  ? "bg-blue-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setTampilPelapor((v) => !v)}
            className={
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition " +
              (tampilPelapor
                ? "bg-indigo-600 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
            }
          >
            👮 Personel {pelapor ? `(${pelapor.length})` : ""}
          </button>
          <button
            onClick={() => setTampilDiri((v) => !v)}
            className={
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition " +
              (tampilDiri
                ? "bg-emerald-600 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
            }
          >
            📍 Posisi saya
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <section className="card map-frame p-0">
        <div className="h-[70dvh] min-h-96 w-full overflow-hidden rounded-2xl">
          <MapContainer
            center={center}
            zoom={12}
            scrollWheelZoom
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {points.map((l) => (
              <Marker
                key={l.id}
                position={[l.latitude!, l.longitude!]}
                icon={buatIcon(l.kategori)}
              >
                <Popup>
                  <div style={{ minWidth: 200 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: l.kategori === "kejadian" ? "#dc2626" : "#2563eb",
                        marginBottom: 2,
                      }}
                    >
                      {l.kategori === "kejadian" ? "⚡ KEJADIAN" : "📋 KEGIATAN"}
                      {l.jenis ? ` · ${l.jenis.nama}` : ""}
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {l.perihal ?? "Laporan"}
                    </div>
                    <div style={{ fontSize: 12, color: "#475569" }}>
                      {l.regu ? reguDisplayName(l.regu) : l.regu_id}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {new Date(l.timestamp_kirim).toLocaleString("id-ID")}
                    </div>
                    {l.catatan && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#334155",
                          marginTop: 6,
                          maxHeight: 80,
                          overflow: "hidden",
                        }}
                      >
                        {l.catatan.slice(0, 220)}
                        {(l.catatan.length ?? 0) > 220 ? "…" : ""}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}

            {tampilPelapor &&
              (pelapor ?? []).map((p) => (
                <Marker
                  key={"p-" + p.regu_id}
                  position={[p.latitude, p.longitude]}
                  icon={buatIconPelapor(p.nama_regu, statusUsia(p.diupdate_pada).warna)}
                >
                  <Popup>
                    <PopupPersonel p={p} />
                  </Popup>
                </Marker>
              ))}

            {/* Posisi pemantau sendiri (hanya tampil di perangkat ini). */}
            {tampilDiri && geo.lat != null && geo.lng != null && (
              <>
                <CircleMarker
                  center={[geo.lat, geo.lng]}
                  radius={Math.min(Math.max(geo.accuracy ?? 30, 15), 200)}
                  pathOptions={{
                    color: "#059669",
                    weight: 1,
                    fillColor: "#10b981",
                    fillOpacity: 0.15,
                  }}
                />
                <Marker
                  position={[geo.lat, geo.lng]}
                  icon={buatIconDiri()}
                >
                  <Popup>
                    <div style={{ minWidth: 160 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#059669",
                          marginBottom: 2,
                        }}
                      >
                        📍 POSISI SAYA
                      </div>
                      <div style={{ fontSize: 12, color: "#475569" }}>
                        Akurasi ± {Math.round(geo.accuracy ?? 0)} m
                      </div>
                      {geo.place && (
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {geo.place.name}, {geo.place.detail}
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              </>
            )}
          </MapContainer>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-blue-600" /> 📋 Kegiatan
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-600" /> ⚡ Kejadian
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-emerald-600" /> 👮 Live (≤2 mnt)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-indigo-600" /> Baru saja (≤15 mnt)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-slate-400" /> Terakhir
          </span>
          <span className="ml-auto">Klik marker untuk detail.</span>
        </div>
      </section>
    </div>
  );
}
