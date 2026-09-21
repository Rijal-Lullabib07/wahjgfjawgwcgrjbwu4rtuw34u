/**
 * Nama tempat untuk PETA (bukan untuk watermark).
 *
 * Layer-1: POI & jalan presisi tinggi — warung, kantor, masjid, dll. via
 *          Overpass API (OpenStreetMap, gratis tanpa key). Dicari POI/jalan
 *          dalam radius ~60 m; fallback ke nama jalan.
 * Layer-2: reverse geocoding area via Nominatim (nama jalan/kelurahan).
 * Hasil di-cache agresif per koordinat (~50 m) di memori + localStorage,
 * dengan antrean agar tidak melebihi 1 req/detik.
 *
 * Sengaja TERPISAH dari src/lib/geo.ts (watermark) agar kebutuhan presisi
 * POI peta tidak mengubah perilaku watermark laporan yang sudah stabil.
 */

export interface NamaTempat {
  /** Label utama: "Warung Makan Barokah", "Jl. Raya Plered", dst. */
  nama: string;
  /** Keterangan singkat: "Kantin · Plered, Purwakarta" atau "" */
  keterangan: string;
}

interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

const memCache = new Map<string, NamaTempat | null>();
const MEM_MAX = 300;
const CACHE_KEY = "siplap_mapplace_cache_v1";
/** ~2 desimal ≈ 1,1 km terlalu kasar; 3 desimal ≈ 111 m. 50 m ≈ 0.00045. */
const COORD_PRECISION = 3;
const MIN_INTERVAL_MS = 1100;
let lastCall = 0;

try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    for (const [k, v] of Object.entries(
      JSON.parse(raw) as Record<string, NamaTempat | null>,
    )) {
      memCache.set(k, v);
    }
  }
} catch {
  /* abaikan */
}

function persist(): void {
  try {
    const obj: Record<string, NamaTempat | null> = {};
    for (const [k, v] of memCache) obj[k] = v;
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* kuota penuh — cache memori saja */
  }
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Label yang layak tampil dari tags OSM (urutan prioritas). */
function labelDariTags(tags: Record<string, string>): string | null {
  const nama =
    tags["name"] ||
    tags["operator"] ||
    tags["brand"] ||
    tags["addr:street"] ||
    null;
  if (!nama) return null;
  return nama;
}

/** Jenis singkat POI: "Kantin", "Masjid", "Kantor Polisi", dst. */
function jenisDariTags(tags: Record<string, string>): string | null {
  const amenity = tags["amenity"];
  const shop = tags["shop"];
  const office = tags["office"];
  const building = tags["building"];
  const map: Record<string, string> = {
    // amenity
    restaurant: "Restoran",
    fast_food: "Warung Makan",
    cafe: "Kafe",
    food_court: "Pusat Jajanan",
    pharmacy: "Apotek",
    hospital: "Rumah Sakit",
    clinic: "Klinik",
    doctors: "Praktik Dokter",
    school: "Sekolah",
    kindergarten: "TK/PAUD",
    college: "Kampus",
    university: "Universitas",
    bank: "Bank",
    atm: "ATM",
    marketplace: "Pasar",
    fuel: "Pom Bensin",
    police: "Kantor Polisi",
    fire_station: "Pemadam Kebakaran",
    place_of_worship: "Tempat Ibadah",
    mosque: "Masjid",
    church: "Gereja",
    community_centre: "Balai Masyarakat",
    townhall: "Kantor Desa/Kelurahan",
    library: "Perpustakaan",
    post_office: "Kantor Pos",
    // shop
    convenience: "Toko Kelontong",
    supermarket: "Supermarket",
    grocery: "Warung Sembako",
  };
  if (amenity && map[amenity]) return map[amenity];
  if (shop && map[shop]) return map[shop];
  if (office === "government") return "Kantor Pemerintah";
  if (building === "civic" || building === "public") return "Gedung Publik";
  return null;
}

/** Overpass: cari POI (node/way) terdekat dalam radius meter. */
async function viaOverpass(
  lat: number,
  lng: number,
  radiusM = 60,
): Promise<OverpassElement | null> {
  const query = `[out:json][timeout:10];
(
  node["name"](around:${radiusM},${lat},${lng});
  way["name"](around:${radiusM},${lat},${lng});
);
out center 8;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { elements?: OverpassElement[] };
  const els = j.elements ?? [];
  if (els.length === 0) return null;

  // Pilih elemen terdekat yang punya jenis dikenal, kalau tidak ada ambil
  // yang terdekat apa pun (biasanya jalan/gedung).
  const jarak = (e: OverpassElement): number => {
    // `center` diberikan oleh `out center` untuk way/relation; elemen node
    // punya lat/lon langsung.
    const elat = e.lat ?? (e as unknown as { center?: { lat?: number } }).center?.lat ?? lat;
    const elng = e.lon ?? (e as unknown as { center?: { lon?: number } }).center?.lon ?? lng;
    const dLat = ((elat - lat) * Math.PI) / 180;
    const dLng = ((elng - lng) * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(latRad) ** 2 * Math.sin(dLng / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.sqrt(a));
  };
  const scored = els
    .map((e) => ({ e, d: jarak(e), jenis: jenisDariTags(e.tags ?? {}) }))
    .sort((a, b) => a.d - b.d);
  return scored.find((s) => s.jenis)?.e ?? scored[0]?.e ?? null;
}

/** Nominatim (fallback): area/jalan dari koordinat. */
async function viaNominatim(lat: number, lng: number): Promise<NamaTempat | null> {
  const url =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2" +
    `&lat=${lat}&lon=${lng}&zoom=18&accept-language=id`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    name?: string;
    address?: Record<string, string>;
  };
  const a = j.address ?? {};
  const jalan = a.road ?? j.name ?? "";
  const kel = a.village ?? a.suburb ?? a.city_district ?? "";
  const kota = a.city ?? a.regency ?? a.county ?? a.municipality ?? "";
  const nama = jalan || j.name || kel || kota;
  if (!nama) return null;
  const ket = [kel, kota].filter(Boolean).join(", ");
  return { nama, keterangan: ket ? `${ket}` : "" };
}

/**
 * Nama tempat terperinci dari koordinat: POI terdekat (warung/kantor/jalan)
 * lalu fallback ke nama jalan/area. Selalu resolve — null bila offline/gagal.
 */
export async function namaTempat(
  lat: number,
  lng: number,
): Promise<NamaTempat | null> {
  const key = cacheKey(lat, lng);
  if (memCache.has(key)) return memCache.get(key) ?? null;
  if (!navigator.onLine) return null;

  const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  let result: NamaTempat | null = null;
  try {
    const poi = await viaOverpass(lat, lng);
    if (poi?.tags) {
      const nama = labelDariTags(poi.tags);
      if (nama) {
        const jenis = jenisDariTags(poi.tags);
        const area = await viaNominatim(lat, lng).catch(() => null);
        result = {
          nama,
          keterangan: [jenis, area?.keterangan].filter(Boolean).join(" · "),
        };
      }
    }
    if (!result) {
      result = await viaNominatim(lat, lng);
    }
  } catch {
    try {
      result = await viaNominatim(lat, lng);
    } catch {
      result = null;
    }
  }

  memCache.set(key, result);
  if (memCache.size > MEM_MAX) {
    const first = memCache.keys().next().value;
    if (first !== undefined) memCache.delete(first);
  }
  persist();
  return result;
}

/** Versi sinkron dari cache saja — untuk render awal popup. */
export function cachedNamaTempat(
  lat: number | null,
  lng: number | null,
): NamaTempat | null {
  if (lat == null || lng == null) return null;
  return memCache.get(cacheKey(lat, lng)) ?? null;
}
